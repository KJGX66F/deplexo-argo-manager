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

// 环境变量或自动随机生成 UUID
const UUID = process.env.UUID || crypto.randomUUID();
const cleanUUID = UUID.replace(/-/g, '').toLowerCase();
const SUB_PATH = process.env.SUB_PATH || 'sub';
const CFIP = process.env.CFIP || 'www.visa.com.tw';

let argoDomain = '';

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/vless' });

// 根目录响应
app.get('/', (req, res) => {
  res.send('Abasthan VLESS Node is Running!');
});

// 节点订阅路由
app.get(`/${SUB_PATH}`, (req, res) => {
  const host = req.headers.host;

  // 1. 直连节点 (推荐首选)
  const vlessDirect = `vless://${UUID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=%2Fvless#Abasthan-Direct`;
  
  // 2. Cloudflare 临时隧道 + 优选 IP 节点
  const targetHost = argoDomain || host;
  const vlessCF = `vless://${UUID}@${CFIP}:443?encryption=none&security=tls&type=ws&host=${targetHost}&path=%2Fvless#Abasthan-ArgoCF`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`${vlessDirect}\n${vlessCF}`);
});

// VLESS 代理服务实现
wss.on('connection', (ws) => {
  let isHeaderParsed = false;
  let targetSocket = null;

  ws.on('message', (chunk) => {
    if (isHeaderParsed) {
      if (targetSocket && targetSocket.writable) {
        targetSocket.write(chunk);
      }
      return;
    }

    if (chunk.length < 24) return;

    const version = chunk[0];
    const clientUuidHex = chunk.slice(1, 17).toString('hex').toLowerCase();

    // 验证 UUID 身份
    if (clientUuidHex !== cleanUUID) {
      ws.close();
      return;
    }

    const addonsLen = chunk[17];
    let offset = 18 + addonsLen;

    const command = chunk[offset++]; // 1: TCP
    const port = chunk.readUInt16BE(offset);
    offset += 2;

    const addrType = chunk[offset++]; // 1: IPv4, 2: Domain, 3: IPv6
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
      for (let i = 0; i < 8; i++) {
        ipv6Parts.push(chunk.readUInt16BE(offset + i * 2).toString(16));
      }
      address = ipv6Parts.join(':');
      offset += 16;
    }

    const payload = chunk.slice(offset);
    isHeaderParsed = true;

    // 返回 VLESS 响应头
    ws.send(Buffer.from([version, 0]));

    // 建立 TCP 连接
    targetSocket = net.connect({ host: address, port: port }, () => {
      if (payload.length > 0) {
        targetSocket.write(payload);
      }
    });

    targetSocket.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    targetSocket.on('error', () => {
      ws.close();
    });

    targetSocket.on('close', () => {
      ws.close();
    });
  });

  ws.on('close', () => {
    if (targetSocket) targetSocket.destroy();
  });

  ws.on('error', () => {
    if (targetSocket) targetSocket.destroy();
  });
});

// 自动下载并启动 Cloudflare Argo 临时隧道
function startCloudflared(port) {
  const binaryPath = path.join(__dirname, 'cloudflared');
  const downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';

  const download = (url) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        download(response.headers.location);
      } else {
        const file = fs.createWriteStream(binaryPath);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          try {
            fs.chmodSync(binaryPath, '755');
            runCloudflared();
          } catch (e) {
            console.error('赋予云端运行权限失败:', e.message);
          }
        });
      }
    }).on('error', (err) => console.error('Cloudflared 下载失败:', err.message));
  };

  const runCloudflared = () => {
    const child = spawn(binaryPath, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);
    
    child.stderr.on('data', (data) => {
      const log = data.toString();
      const match = log.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        argoDomain = match[0].replace('https://', '');
        console.log(`[Argo Tunnel] 域名已生效: ${argoDomain}`);
      }
    });
  };

  if (!fs.existsSync(binaryPath)) {
    download(downloadUrl);
  } else {
    runCloudflared();
  }
}

// 监听指定端口与 0.0.0.0 IP 地址
server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`[VLESS] 服务已成功启动！`);
  console.log(`[VLESS] 端口: ${PORT}`);
  console.log(`[VLESS] 本次随机 UUID: ${UUID}`);
  console.log(`========================================`);
  startCloudflared(PORT);
});
