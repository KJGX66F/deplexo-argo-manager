const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');
const INTERNAL_PORT = 8080; // Sing-box 监听的内部端口
const UUID = process.env.UUID || crypto.randomUUID();
const WSPATH = process.env.WSPATH || '/vless-ws';
const DOMAIN = process.env.DOMAIN || '';

// 1. 生成 Sing-box 配置文件（监听内部端口 INTERNAL_PORT）
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

fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(singboxConfig, null, 2));

// 2. HTTP 根路由：响应 Deplexo 平台的健康检查
app.get('/', (req, res) => {
  res.status(200).send('Deplexo VLESS & Argo Service is Running!');
});

// 3. 将平台的 WebSocket 请求转发给 Sing-box 内部端口
app.use(
  WSPATH,
  createProxyMiddleware({
    target: `http://127.0.0.1:${INTERNAL_PORT}`,
    ws: true,
    changeOrigin: true,
    logLevel: 'silent'
  })
);

// 4. 启动 Express 监听 PORT
app.listen(PORT, () => {
  console.log('==================================================');
  console.log(`[Express] 服务启动成功，监听端口: ${PORT}`);
  console.log(`[系统] 节点 UUID: ${UUID}`);
  console.log(`[系统] WebSocket Path: ${WSPATH}`);
  console.log('==================================================');

  startSubServices();
});

function startSubServices() {
  // 启动 Sing-box 核心
  const sb = spawn('./sing-box', ['run', '-c', 'config.json']);
  sb.stdout.on('data', (d) => console.log(`[sing-box] ${d.toString().trim()}`));
  sb.stderr.on('data', (d) => console.error(`[sing-box] ${d.toString().trim()}`));

  // 启动 Cloudflare Argo 隧道（穿透内部端口 INTERNAL_PORT）
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
