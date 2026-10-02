const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');
const UUID = process.env.UUID || '3000a6e3-1d01-443f-a39c-512c1a8e1882';
const WSPATH = process.env.WSPATH || '/vless-ws';

// 生成 Sing-box VLESS 配置文件
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

// 自动下载并启动 Sing-box 二进制
const SINGBOX_URL = 'https://github.com/SagerNet/sing-box/releases/download/v1.10.1/sing-box-1.10.1-linux-amd64.tar.gz';

console.log('Downloading sing-box binary...');
exec(`curl -L ${SINGBOX_URL} | tar -xz && mv sing-box-*/sing-box ./sing-box && chmod +x ./sing-box`, (err) => {
  if (err) {
    console.error('Failed to download sing-box:', err);
    return;
  }
  console.log('Sing-box binary downloaded successfully.');

  // 启动 Sing-box 服务进程
  const sb = spawn('./sing-box', ['run', '-c', 'config.json']);

  sb.stdout.on('data', (data) => console.log(`[sing-box] ${data}`));
  sb.stderr.on('data', (data) => console.error(`[sing-box] ${data}`));

  sb.on('close', (code) => {
    console.log(`sing-box exited with code ${code}`);
  });
});

// 保留健康检查路由
app.get('/', (req, res) => {
  res.send('Sing-box VLESS node is running.');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`VLESS UUID: ${UUID}`);
  console.log(`WebSocket Path: ${WSPATH}`);
});
