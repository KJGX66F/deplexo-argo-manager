const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn, execSync } = require('child_process');
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

const CONFIG_PATH = path.join(os.tmpdir(), 'config.json');

let globalArgoDomain = '';
let globalArgoVless = '';
let argoLogBuffer = [];

// 1. 自动为二进制文件赋予 Linux 执行权限 (chmod +x)
function grantPermissions() {
  ['sing-box', 'cloudflared'].forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      try {
        fs.chmodSync(filePath, '755');
        console.log(`[权限] 已成功设置 ${file} 为可执行`);
      } catch (e) {
        try { execSync(`chmod +x ${filePath}`); } catch (err) {}
      }
    } else {
      argoLogBuffer.push(`[错误] 根目录下未找到 ${file} 文件！`);
      console.error(`[错误] 未找到文件: ${filePath}`);
    }
  });
}
grantPermissions();

// 2. 生成 Sing-box 配置文件
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
} catch (err) {
  console.error('[系统] 写入配置文件失败:', err);
}

// 3. 网页面板
app.get('/', (req, res) => {
  const hostHeader = DOMAIN || req.headers.host || 'olive-echo-1048.de.deplexo.com';
  const directLink = `vless://${UUID}@${hostHeader}:443?type=ws&security=tls&path=${encodeURIComponent(WSPATH)}&host=${hostHeader}&sni=${hostHeader}#Deplexo-Direct-VLESS`;

  let html = `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Deplexo VLESS 节点配置</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; padding: 20px; color: #333; }
      .card { background: #fff; border-radius: 12px; padding: 24px; max-width: 680px; margin: 20px auto; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
      h2 { margin-top: 0; color: #1a1a1a; font-size: 20px; }
      h3 { font-size: 15px; margin-top: 20px; color: #444; }
      .info { font-size: 14px; line-height: 1.6; background: #fafafa; padding: 12px; border-radius: 8px; margin-bottom: 15px; }
      .link-box { background: #f1f3f5; border: 1px solid #e9ecef; border-radius: 6px; padding: 10px; word-break: break-all; font-family: monospace; font-size: 12px; margin: 8px 0; }
      .btn { background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
      .btn:hover { background: #1d4ed8; }
      .status { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; background: #dcfce7; color: #15803d; }
      .status.waiting { background: #fef3c7; color: #b45309; }
      .log-box { background: #1e1e1e; color: #00ff66; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; max-height: 140px; overflow-y: auto; white-space: pre-wrap; margin-top: 8px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>🚀 VLESS 节点配置面板 <span class="status">运行中</span></h2>
      <div class="info">
        <div><b>UUID:</b> <code>${UUID}</code></div>
        <div><b>WebSocket Path:</b> <code>${WSPATH}</code></div>
        <div><b>订阅地址:</b> <code>https://${hostHeader}/sub</code></div>
      </div>

      <h3>1. 平台直连 VLESS 节点 <span style="font-size:12px;color:#ef4444;">(受 GFW 封锁影响可能不可用)</span></h3>
      <div class="link-box" id="direct-link">${directLink}</div>
      <button class="btn" onclick="copyText('direct-link')">复制直连节点</button>

      <h3>2. Cloudflare Argo 临时隧道 VLESS 节点 <span style="font-size:12px;color:#10b981;">(推荐使用)</span></h3>
  `;

  if (globalArgoVless) {
    html += `
      <div class="link-box" id="argo-link">${globalArgoVless}</div>
      <button class="btn" onclick="copyText('argo-link')">复制 Argo 节点</button>
    `;
  } else {
    const recentLogs = argoLogBuffer.slice(-8).join('\n') || '等待 Cloudflared 进程响应...';
    html += `
      <p><span class="status waiting">⌛ Argo 隧道连接中，请稍后刷新页面...</span></p>
      <div style="font-size:12px;color:#666;">后台启动日志：</div>
      <div class="log-box">${recentLogs}</div>
      <button class="btn" style="margin-top:10px;background:#4b5563;" onclick="location.reload()">刷新页面</button>
    `;
  }

  html += `
    </div>
    <script>
      function copyText(id) {
        const text = document.getElementById(id).innerText;
        navigator.clipboard.writeText(text).then(() => alert('已成功复制到剪贴板！'));
      }
    </script>
  </body>
  </html>
  `;

  res.send(html);
});

// 4. 订阅地址
app.get('/sub', (req, res) => {
  const hostHeader = DOMAIN || req.headers.host || 'olive-echo-1048.de.deplexo.com';
  const directLink = `vless://${UUID}@${hostHeader}:443?type=ws&security=tls&path=${encodeURIComponent(WSPATH)}&host=${hostHeader}&sni=${hostHeader}#Deplexo-Direct-VLESS`;
  
  let list = [directLink];
  if (globalArgoVless) list.push(globalArgoVless);
  
  const base64Sub = Buffer.from(list.join('\n')).toString('base64');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(base64Sub);
});

// 5. WebSocket 转发
app.use(
  WSPATH,
  createProxyMiddleware({
    target: `http://127.0.0.1:${INTERNAL_PORT}`,
    ws: true,
    changeOrigin: true,
    logLevel: 'silent'
  })
);

app.listen(PORT, () => {
  console.log(`[Express] 服务启动成功，监听端口: ${PORT}`);
  startSubServices();
});

function startSubServices() {
  // 启动 Sing-box
  try {
    const sb = spawn('./sing-box', ['run', '-c', CONFIG_PATH], { cwd: __dirname });
    sb.stdout.on('data', (d) => console.log(`[sing-box] ${d.toString().trim()}`));
    sb.stderr.on('data', (d) => console.error(`[sing-box] ${d.toString().trim()}`));
    sb.on('error', (err) => console.error('[sing-box 启动错误]:', err));
  } catch (err) {
    console.error('[sing-box 执行错误]:', err);
  }

  // 启动 Cloudflare Argo
  try {
    const argo = spawn('./cloudflared', [
      'tunnel',
      '--no-autoupdate',
      '--protocol', 'http2',
      '--url', `http://127.0.0.1:${INTERNAL_PORT}`
    ], { cwd: __dirname });

    const parseArgo = (data) => {
      const str = data.toString().trim();
      argoLogBuffer.push(str);
      if (argoLogBuffer.length > 30) argoLogBuffer.shift();

      const match = str.match(/https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
      if (match && match[1] && !globalArgoDomain) {
        globalArgoDomain = match[1];
        const encodedPath = encodeURIComponent(WSPATH);
        globalArgoVless = `vless://${UUID}@${globalArgoDomain}:443?type=ws&security=tls&path=${encodedPath}&host=${globalArgoDomain}&sni=${globalArgoDomain}#Deplexo-Argo-VLESS`;
        console.log(`[Argo] 隧道生成成功: ${globalArgoDomain}`);
      }
    };

    argo.stdout.on('data', parseArgo);
    argo.stderr.on('data', parseArgo);
    argo.on('error', (err) => {
      const msg = `[cloudflared 启动失败] ${err.message} (请检查仓库根目录下是否存在 cloudflared Linux 64位可执行文件)`;
      console.error(msg);
      argoLogBuffer.push(msg);
    });
  } catch (err) {
    argoLogBuffer.push(`[cloudflared 执行异常] ${err.message}`);
  }
}

process.on('uncaughtException', (err) => console.error('[Uncaught Exception]', err));
process.on('unhandledRejection', (reason) => console.error('[Unhandled Rejection]', reason));
