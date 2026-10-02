const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// 【核心逻辑】优先读取环境变量 process.env.UUID；未设置则每次启动随机生成 UUID
const UUID = process.env.UUID || crypto.randomUUID();
const cleanUUID = UUID.replace(/-/g, '').toLowerCase();

// 订阅路径优先读取 process.env.SUB_PATH；未设置则与当前 UUID 一致
const SUB_PATH = process.env.SUB_PATH || UUID;

// 预设高质量社区动态优选域名与企业级 CF 域名
const DEFAULT_CF_NODES = [
  { name: 'CF-动态优选1', domain: 'cf.090227.xyz' },
  { name: 'CF-动态优选2', domain: 'ip.164746.xyz' },
  { name: 'CF-动态优选3', domain: 'bestcf.onecf.eu.org' },
  { name: 'CF-动态优选4', domain: 'cf.886.best' },
  { name: 'CF-工行节点', domain: 'icbc.com.cn' },
  { name: 'CF-Visa台湾', domain: 'www.visa.com.tw' },
  { name: 'CF-Shopify', domain: 'shopify.com' },
  { name: 'CF-TimeIs', domain: 'time.is' }
];

let argoDomain = '';

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/vless' });

app.get('/', (req, res) => {
  res.send(`Abasthan VLESS Server is Running! Argo: ${argoDomain || 'Connecting...'}`);
});

// 节点订阅路由
app.get(`/${SUB_PATH}`, (req, res) => {
  const host = req.headers.host;
  const nodeList = [];

  // 直连节点
  nodeList.push(`vless://${UUID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=%2Fvless#Abasthan-Direct`);

  // CF 优选节点
  if (argoDomain) {
    DEFAULT_CF_NODES.forEach((item) => {
      const remark = encodeURIComponent(`Abasthan-${item.name}`);
      nodeList.push(`vless://${UUID}@${item.domain}:443?encryption=none&security=tls&type=ws&host=${argoDomain}&path=%2Fvless#${remark}`);
    });
  } else {
    nodeList.push(`vless://${UUID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=%2Fvless#Argo隧道建立中_10秒后刷新订阅`);
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(nodeList.join('\n'));
});

// VLESS 代理实现
wss.on('connection', (ws) => {
  let isHeaderParsed = false;
  let targetSocket = null;

  ws.on('message', (chunk) => {
    if (isHeaderParsed) {
      if (targetSocket && targetSocket.writable) targetSocket.write(chunk);
      return;
    }

    if (chunk.length < 24) return;

    const version = chunk[0];
    const clientUuidHex = chunk.slice(1, 17).toString('hex').toLowerCase();

    // 校验 UUID 鉴权
    if (clientUuidHex !== cleanUUID) {
      ws.close();
      return;
    }

    const addonsLen = chunk[17];
    let offset = 18 + addonsLen;

    const command = chunk[offset++];
    const port = chunk.readUInt16BE(offset);
    offset += 2;

    const addrType = chunk[offset++];
    let address = '';

    if (addrType === 1) {
      address = chunk.slice(offset, offset + 4).join('.');
      offset += 4;
    } else if (addrType === 2) {
      const addrLen = chunk[offset++];
      address = chunk.slice(offset, offset + addrLen).toString('utf-8');
      offset += addrLen;
    } else if (addrType === 3) {
      const ipv6Parts = [];
      for (let i = 0; i < 8; i++) ipv6Parts.push(chunk.readUInt16BE(offset + i * 2).toString(16));
      address = ipv6Parts.join(':');
      offset += 16;
    }

    const payload = chunk.slice(offset);
    isHeaderParsed = true;

    ws.send(Buffer.from([version, 0]));

    targetSocket = net.connect({ host: address, port: port }, () => {
      if (payload.length > 0) targetSocket.write(payload);
    });

    targetSocket.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    targetSocket.on('error', () => ws.close());
    targetSocket.on('close', () => ws.close());
  });

  ws.on('close', () => { if (targetSocket) targetSocket.destroy(); });
  ws.on('error', () => { if (targetSocket) targetSocket.destroy(); });
});

// 使用镜像源加速下载并启动 Argo 隧道
function startCloudflared(port) {
  const binaryPath = path.join(__dirname, 'cloudflared');
  const downloadUrl = 'https://ghfast.top/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';

  const runCloudflared = () => {
    try {
      fs.chmodSync(binaryPath, '755');
    } catch (e) {}

    const child = spawn(binaryPath, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);

    child.stderr.on('data', (data) => {
      const log = data.toString();
      const match = log.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        argoDomain = match[0].replace('https://', '');
        console.log(`\n========================================`);
        console.log(`[Argo Tunnel] 隧道建立成功: ${argoDomain}`);
        console.log(`========================================\n`);
      }
    });

    child.on('error', (err) => console.error('[Argo] 启动失败:', err.message));
  };

  const downloadFile = (url, redirects = 0) => {
    if (redirects > 5) return;
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, redirects + 1);
      } else if (res.statusCode === 200) {
        const file = fs.createWriteStream(binaryPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => setTimeout(runCloudflared, 1000));
        });
      } else {
        console.error(`[Argo] 下载失败，HTTP状态码: ${res.statusCode}`);
      }
    }).on('error', (err) => console.error('[Argo] 下载错误:', err.message));
  };

  if (!fs.existsSync(binaryPath) || fs.statSync(binaryPath).size < 10000000) {
    console.log('[Argo] 正在通过镜像加速源下载 cloudflared...');
    downloadFile(downloadUrl);
  } else {
    runCloudflared();
  }
}

// 启动服务
server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`[VLESS] 服务已启动！`);
  console.log(`[VLESS] 当前使用的 UUID: ${UUID}`);
  console.log(`[VLESS] 订阅地址路径: /${SUB_PATH}`);
  console.log(`========================================`);
  startCloudflared(PORT);
});
