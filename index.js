const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 动态生成随机 UUID
const UUID = process.env.UUID || crypto.randomUUID();
const SUB_PATH = process.env.SUB_PATH || 'sub';
const CFIP = process.env.CFIP || 'www.visa.com.tw';

console.log('========================================');
console.log(`[Sing-box] 本次随机生成 UUID: ${UUID}`);
console.log(`[Sing-box] 订阅路径: /${SUB_PATH}`);
console.log('========================================');

// 简单网页根路径响应
app.get('/', (req, res) => {
  res.send('Hello, Service is Running!');
});

// 节点订阅路由
app.get(`/${SUB_PATH}`, (req, res) => {
  const host = req.headers.host;
  const vlessLink = `vless://${UUID}@${CFIP}:443?encryption=none&security=tls&type=ws&host=${host}&path=%2Fvless#Abasthan-VLESS`;
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(vlessLink);
});

app.listen(PORT, () => {
  console.log(`Web Server running on port ${PORT}`);
});
