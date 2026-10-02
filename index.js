const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');
const UUID = process.env.UUID || crypto.randomUUID();
const WSPATH = process.env.WSPATH || '/vless-ws';
const DOMAIN = process.env.DOMAIN || '';

// 生成 Sing-box 配置文件
const singboxConfig = {
  "log": { "level": "info", "timestamp": true },
  "inbounds": [{
    "type": "vless",
    "tag": "vless-in",
    "listen": "::",
    "listen_port": PORT,
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

fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(singboxConfig, null, 2));

function startServices() {
  console.log('==================================================');
  console.log(`[系统] 节点 UUID: ${UUID}`);
  console.log(`[系统] WebSocket Path: ${WSPATH}`);
  console.log('==================================================');

  // 1. 启动 Sing-box
  const sb = spawn('./sing-box', ['run', '-c', 'config.json']);
  sb.stdout.on('data', (d) => console.log(`[sing-box] ${d.toString().trim()}`));
  sb.stderr.on('data', (d) => console.error(`[sing-box] ${d.toString().trim()}`));

  // 2. 启动 Cloudflare Argo 临时隧道
  const argo = spawn('./cloudflared', ['tunnel', '--url', `http://127.0.0.1:${PORT}`]);
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
  console.log('            🎉 节点启动成功 🎉                   ');
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

app.get('/', (req, res) => res.send('Sing-box VLESS is running.'));

app.listen(PORT, () => {
  console.log(`[Express] Web 服务已监听端口 ${PORT}`);
  startServices();
});
