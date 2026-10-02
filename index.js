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

// 预设多个优质 CF 优选域名/IP（可随意增减或通过环境变量控制）
// 预设多个高质量社区动态优选域名与企业级 CF 域名
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

// 根目录响应
app.get('/', (req, res) => {
  res.send('Abasthan VLESS Multi-Node Server is Running!');
});

// 节点订阅路由：动态生成多个 CF 节点
app.get(`/${SUB_PATH}`, (req, res) => {
  const host = req.headers.host;
  const targetHost = argoDomain || host;
  const nodeList = [];

  // 1. 直连节点 (不经过 CF 中转)
  nodeList.push(`vless://${UUID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=%2Fvless#Abasthan-Direct`);

  // 2. 遍历多域名生成多个 CF 加速节点
  DEFAULT_CF_NODES.forEach((item) => {
    const remark = encodeURIComponent(`Abasthan-${item.name}`);
    nodeList.push(`vless://${UUID}@${item.domain}:443?encryption=none&security=tls&type=ws&host=${targetHost}&path=%2Fvless#${remark}`);
  });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(nodeList.join('\n'));
});

// VLESS 代理逻辑处理
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

    ws.send(Buffer.from([version, 0]));

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

    targetSocket.on('error', () => ws.close());
    targetSocket.on('close', () => ws.close());
  });

  ws.on('close', () => {
    if (targetSocket) targetSocket.destroy();
  });

  ws.on('error', () => {
    if (targetSocket) targetSocket.destroy();
  });
});

// 自动下载并启动 Argo 隧道
function startCloudflared(port) {
  const binaryPath = path.join(__dirname, 'cloudflared');
  const downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';

  const runCloudflared = () => {
    try {
      fs.chmodSync(binaryPath, '755');
    } catch (e) {
      console.error('赋予权限失败:', e.message);
    }

    const child = spawn(binaryPath, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);
    
    child.stderr.on('data', (data) => {
      const log = data.toString();
      const match = log.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        argoDomain = match[0].replace('https://', '');
        console.log(`[Argo Tunnel] 隧道建立成功: ${argoDomain}`);
      }
    });

    child.on('error', (err) => {
      console.error('[Argo Tunnel] 启动失败:', err.message);
    });
  };

  const download = (url) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        download(response.headers.location);
      } else {
        const file = fs.createWriteStream(binaryPath);
        response.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            setTimeout(() => {
              runCloudflared();
            }, 1000);
          });
        });
      }
    }).on('error', (err) => console.error('Cloudflared 下载失败:', err.message));
  };

  if (!fs.existsSync(binaryPath)) {
    download(downloadUrl);
  } else {
    runCloudflared();
  }
}

// 启动服务与防休眠保活
server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`[VLESS] 服务已启动，访问 /${SUB_PATH} 获取多节点订阅`);
  console.log(`========================================`);
  startCloudflared(PORT);

  // 每 4 分钟请求一次自身，防止容器休眠
  setInterval(() => {
    https.get(`https://address-probable-gorilla.abasthan.app/`, () => {}).on('error', () => {});
  }, 4 * 60 * 1000);
});
