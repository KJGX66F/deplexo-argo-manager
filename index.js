const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// 如果环境变量未指定 UUID，则随机自动生成 UUID
const UUID = process.env.UUID || crypto.randomUUID();
const WSPATH = process.env.WSPATH || '/vless-ws';
const DOMAIN = process.env.DOMAIN || ''; // 填入 Deplexo 给你的域名（可选）

// 1. 生成 Sing-box VLESS 配置文件
const singboxConfig = {
  "log": {
    "level": "info",
    "timestamp": true
  },
  "inbounds": [
    {
      "type": "vless",
      "tag": "vless-in",
      "listen": "::",
      "listen_port": PORT,
      "users": [
        {
          "uuid": UUID,
          "flow": ""
        }
      ],
      "transport": {
        "type": "ws",
        "path": WSPATH,
        "max_early_data": 2048,
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    }
  ],
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    }
  ]
};

// 写入 config.json
fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(singboxConfig, null, 2));

// 2. 初始化核心组件并启动服务
async function init() {
  console.log('==================================================');
  console.log(`[系统] 节点 UUID: ${UUID}`);
  console.log(`[系统] WebSocket Path: ${WSPATH}`);
  console.log('==================================================');

  // 自动下载 Sing-box 与 cloudflared 执行文件
  const downloadCmd = `
    if [ ! -f ./sing-box ]; then
      echo "Downloading sing-box..."
      curl -sL https://github.com/SagerNet/sing-box/releases/download/v1.10.1/sing-box-1.10.1-linux-amd64.tar.gz | tar -xz && mv sing-box-*/sing-box ./sing-box && chmod +x ./sing-box
    fi
    if [ ! -f ./cloudflared ]; then
      echo "Downloading cloudflared..."
      curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ./cloudflared && chmod +x ./cloudflared
    fi
  `;

  exec(downloadCmd, (err) => {
    if (err) {
      console.error('[错误] 下载核心文件失败:', err);
      return;
    }
    console.log('[成功] 组件部署就绪，正在启动 Sing-box 及 Argo 隧道...');

    // 启动 Sing-box 核心
    const sb = spawn('./sing-box', ['run', '-c', 'config.json']);
    sb.stdout.on('data', (data) => console.log(`[sing-box] ${data.toString().trim()}`));
    sb.stderr.on('data', (data) => console.error(`[sing-box] ${data.toString().trim()}`));

    // 启动 Cloudflare Argo 临时隧道
    const argo = spawn('./cloudflared', ['tunnel', '--url', `http://127.0.0.1:${PORT}`]);

    let argoDomain = '';
    const parseArgoDomain = (data) => {
      const logStr = data.toString();
      // 提取 trycloudflare.com 临时域名
      const match = logStr.match(/https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
      if (match && match[1] && !argoDomain) {
        argoDomain = match[1];
        printVlessLinks(argoDomain);
      }
    };

    argo.stdout.on('data', parseArgoDomain);
    argo.stderr.on('data', parseArgoDomain);
  });
}

// 3. 在日志中输出完整的 VLESS 链接
function printVlessLinks(argoDomain) {
  const encodedPath = encodeURIComponent(WSPATH);
  
  // 生成 Argo 节点链接
  const argoVlessLink = `vless://${UUID}@${argoDomain}:443?type=ws&security=tls&path=${encodedPath}&host=${argoDomain}&sni=${argoDomain}#Deplexo-Argo-VLESS`;

  console.log('\n==================================================');
  console.log('            🎉 节点启动成功 🎉                   ');
  console.log('==================================================');
  console.log(`\n【Argo 临时隧道 VLESS 节点链接】:`);
  console.log(argoVlessLink);

  // 如果在 Env Vars 配置了 DOMAIN，同时输出平台直连链接
  if (DOMAIN) {
    const directVlessLink = `vless://${UUID}@${DOMAIN}:443?type=ws&security=tls&path=${encodedPath}&host=${DOMAIN}&sni=${DOMAIN}#Deplexo-Direct-VLESS`;
    console.log(`\n【Deplexo 平台直连 VLESS 节点链接】:`);
    console.log(directVlessLink);
  } else {
    console.log(`\n💡 提示: 如果在 Env Vars 中配置变量 DOMAIN=你的Deplexo分配域名，此处会同时生成直连节点。`);
  }
  console.log('==================================================\n');
}

// 健康检查路由
app.get('/', (req, res) => {
  res.send('Sing-box VLESS + Argo Node is active.');
});

app.listen(PORT, () => {
  console.log(`[Express] Web 服务运行在端口: ${PORT}`);
  init();
});
