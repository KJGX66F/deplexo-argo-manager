const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');
const INTERNAL_PORT = 8080; 
const UUID = process.env.UUID || crypto.randomUUID();
const WSPATH = process.env.WSPATH || '/vless-ws';
const DOMAIN = process.env.DOMAIN || '';

// 将配置文件写入 /tmp 临时目录，避开 /app 只读限制
const CONFIG_PATH = path.join(os.tmpdir(), 'config.json');

// 1. 生成 Sing-box 配置文件
const singboxConfig = {
  "log": { "level": "info", "timestamp": true },
  "inbounds": [{
    "type": "vless",
    "tag": "vless-in",
    "listen": "127.0.0.1",
    "listen_port": INTERNAL_PORT,
    "users": [{ "uuid": UUID, "flow": "" }],
    "transport": {
      "type": "ws",
      "path": WSPATH,
      "max_early_data": 2048,
      "early_data_header_name": "Sec-WebSocket-Protocol"
    }
  }],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
};

try {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(singboxConfig, null, 2));
  console.log(`[系统] 配置文件已生成至: ${CONFIG_PATH}`);
} catch (err) {
  console.error('[系统] 写入配置文件失败:', err);
}

// 2. HTTP 根路由：响应平台健康检查
app.get('/', (req, res) => {
  res.status(200).send('Deplexo VLESS Service is Running!');
});

// 3. WebSocket 流量转发
app.use(
  WSPATH,
  createProxyMiddleware({
    target: `http://127.0.0.1:${INTERNAL_PORT}`,
    ws: true,
    changeOrigin: true,
    logLevel: 'silent'
  })
);

// 4. 启动 HTTP 服务
app.listen(PORT, () => {
  console.log('==================================================');
  console.log(`[Express] 服务已启动，监听端口: ${PORT}`);
  console.log(`[系统] 节点 UUID: ${UUID}`);
  console.log(`[系统] WebSocket Path: ${WSPATH}`);
  console.log('==================================================');

  startSubServices();
});

function startSubServices() {
  // 启动 Sing-box，指定 /tmp/config.json
  const sb = spawn('./sing-box', ['run', '-c', CONFIG_PATH]);
  sb.stdout.on('data', (d) => console.log(`[sing-box] ${d.toString().trim()}`));
  sb.stderr.on('data', (d) => console.error(`[sing-box] ${d.toString().trim()}`));

  // 启动 Cloudflare Argo 临时隧道
  const argo = spawn('./cloudflared', ['tunnel', '--url', `http://127.0.0.1:${INTERNAL_PORT}`]);
  let argoDomain = '';

  const parseArgo = (data) => {
    const str = data.toString();
    const match = str.match(/https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
    if (match && match[1] && !argoDomain) {
      argoDomain = match[1];
      printLinks(argoDomain);
    }
  };

  argo.stdout.on('data', parseArgo);
  argo.stderr.on('data', parseArgo);
}

function printLinks(argoDomain) {
  const encodedPath = encodeURIComponent(WSPATH);
  const argoVless = `vless://${UUID}@${argoDomain}:443?type=ws&security=tls&path=${encodedPath}&host=${argoDomain}&sni=${argoDomain}#Deplexo-Argo-VLESS`;

  console.log('\n==================================================');
  console.log('            🎉 节点搭建成功 🎉                   ');
  console.log('==================================================');
  console.log(`\n【Argo 临时隧道 VLESS 节点链接】:`);
  console.log(argoVless);

  if (DOMAIN) {
    const directVless = `vless://${UUID}@${DOMAIN}:443?type=ws&security=tls&path=${encodedPath}&host=${DOMAIN}&sni=${DOMAIN}#Deplexo-Direct-VLESS`;
    console.log(`\n【Deplexo 平台直连 VLESS 节点链接】:`);
    console.log(directVless);
  }
  console.log('==================================================\n');
}

process.on('uncaughtException', (err) => console.error('[Uncaught Exception]', err));
process.on('unhandledRejection', (reason) => console.error('[Unhandled Rejection]', reason));
