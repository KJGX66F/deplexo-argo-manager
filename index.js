const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');
const INTERNAL_PORT = 8080; 
const UUID = process.env.UUID || crypto.randomUUID();
const WSPATH = process.env.WSPATH || '/vless-ws';
const DOMAIN = process.env.DOMAIN || '';

// 工作目录定义在当前项目根目录
const WORK_DIR = __dirname;
const CONFIG_PATH = path.join(WORK_DIR, 'config.json');
const SB_PATH = path.join(WORK_DIR, 'sing-box');
const CF_PATH = path.join(WORK_DIR, 'cloudflared');

let globalArgoDomain = '';
let globalArgoVless = '';
let argoLogBuffer = [];

// 自动识别 CPU 架构
function getArch() {
  const arch = process.arch;
  if (arch === 'arm64') return 'arm64';
  return 'amd64';
}

// 强力三重保障下载函数 (curl -> wget -> Node https)
async function downloadFile(url, destPath) {
  // 方式 1: 优先使用系统的 curl (处理重定向和 GitHub 鉴权极佳)
  try {
    execSync(`curl -fsSL -L "${url}" -o "${destPath}"`, { stdio: 'ignore', timeout: 60000 });
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) return;
  } catch (e) {}

  // 方式 2: 备用 wget
  try {
    execSync(`wget -q -O "${destPath}" "${url}"`, { stdio: 'ignore', timeout: 60000 });
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) return;
  } catch (e) {}

  // 方式 3: Node.js 原生 https 请求 (带 User-Agent 与自动跟随重定向)
  return new Promise((resolve, reject) => {
    const fetchUrl = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 10) return reject(new Error('重定向次数过多'));
      
      const parsedUrl = new URL(currentUrl);
      const req = (parsedUrl.protocol === 'https:' ? https : http).get(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, currentUrl).href;
          return fetchUrl(nextUrl, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP 状态码: ${res.statusCode}`));
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });
      req.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    };
    fetchUrl(url);
  });
}

// 赋予可执行权限
function setExecutable(filePath) {
  try { fs.chmodSync(filePath, 0o755); } catch (e) {}
  try { execSync(`chmod +x "${filePath}"`); } catch (e) {}
}

// 下载与准备依赖文件
async function prepareBinaries() {
  const arch = getArch();
  argoLogBuffer.push(`[系统] 识别环境架构: Linux ${arch}`);

  // 1. 下载 cloudflared
  if (!fs.existsSync(CF_PATH)) {
    argoLogBuffer.push('[系统] 正在下载 cloudflared...');
    try {
      const cfUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
      await downloadFile(cfUrl, CF_PATH);
      if (fs.existsSync(CF_PATH) && fs.statSync(CF_PATH).size > 1000) {
        setExecutable(CF_PATH);
        argoLogBuffer.push('[系统] cloudflared 下载成功并已赋予权限！');
      } else {
        argoLogBuffer.push('[错误] cloudflared 下载文件无效或为空');
      }
    } catch (e) {
      argoLogBuffer.push(`[错误] cloudflared 下载失败: ${e.message}`);
    }
  } else {
    setExecutable(CF_PATH);
  }

  // 2. 下载 sing-box
  if (!fs.existsSync(SB_PATH)) {
    argoLogBuffer.push('[系统] 正在下载 sing-box...');
    const tarPath = path.join(WORK_DIR, 'sing-box.tar.gz');
    try {
      const sbUrl = `https://github.com/SagerNet/sing-box/releases/download/v1.10.7/sing-box-1.10.7-linux-${arch}.tar.gz`;
      await downloadFile(sbUrl, tarPath);
      
      try {
        execSync(`tar -zxvf "${tarPath}" -C "${WORK_DIR}" --strip-components=1`);
      } catch (e) {
        execSync(`tar -zxvf "${tarPath}" -C "${WORK_DIR}"`);
      }
      if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);

      // 如果解压到了子目录，自动寻找并移动到根目录
      if (!fs.existsSync(SB_PATH)) {
        const files = fs.readdirSync(WORK_DIR);
        for (const file of files) {
          const subDir = path.join(WORK_DIR, file);
          if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
            const nestedSb = path.join(subDir, 'sing-box');
            if (fs.existsSync(nestedSb)) {
              fs.renameSync(nestedSb, SB_PATH);
              break;
            }
          }
        }
      }

      if (fs.existsSync(SB_PATH)) {
        setExecutable(SB_PATH);
        argoLogBuffer.push('[系统] sing-box 安装成功并已赋予权限！');
      } else {
        argoLogBuffer.push('[错误] sing-box 解压后未找到二进制程序');
      }
    } catch (e) {
      argoLogBuffer.push(`[错误] sing-box 下载/解压失败: ${e.message}`);
    }
  } else {
    setExecutable(SB_PATH);
  }
}

// 写入 Sing-box 配置文件
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

// Web 配置面板页面
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
      .log-box { background: #1e1e1e; color: #00ff66; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 11px; max-height: 180px; overflow-y: auto; white-space: pre-wrap; margin-top: 8px; }
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
    const recentLogs = argoLogBuffer.slice(-12).join('\n') || '正在初始化并下载依赖程序...';
    html += `
      <p><span class="status waiting">⌛ 正在连接 Argo 隧道，请几秒后刷新...</span></p>
      <div style="font-size:12px;color:#666;">后台日志输出：</div>
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

// 订阅接口
app.get('/sub', (req, res) => {
  const hostHeader = DOMAIN || req.headers.host || 'olive-echo-1048.de.deplexo.com';
  const directLink = `vless://${UUID}@${hostHeader}:443?type=ws&security=tls&path=${encodeURIComponent(WSPATH)}&host=${hostHeader}&sni=${hostHeader}#Deplexo-Direct-VLESS`;
  
  let list = [directLink];
  if (globalArgoVless) list.push(globalArgoVless);
  
  const base64Sub = Buffer.from(list.join('\n')).toString('base64');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(base64Sub);
});

// WebSocket 流量转发
app.use(
  WSPATH,
  createProxyMiddleware({
    target: `http://127.0.0.1:${INTERNAL_PORT}`,
    ws: true,
    changeOrigin: true,
    logLevel: 'silent'
  })
);

app.listen(PORT, async () => {
  console.log(`[Express] 服务启动成功，监听端口: ${PORT}`);
  try {
    await prepareBinaries();
    startSubServices();
  } catch (err) {
    argoLogBuffer.push(`[初始化错误] ${err.message}`);
  }
});

function startSubServices() {
  // 校验并启动 Sing-box
  if (!fs.existsSync(SB_PATH)) {
    argoLogBuffer.push(`[错误] 无法启动 sing-box: 文件不存在`);
  } else {
    try {
      const sb = spawn(SB_PATH, ['run', '-c', CONFIG_PATH]);
      sb.stdout.on('data', (d) => console.log(`[sing-box] ${d.toString().trim()}`));
      sb.stderr.on('data', (d) => console.error(`[sing-box] ${d.toString().trim()}`));
      sb.on('error', (err) => argoLogBuffer.push(`[sing-box 启动错误] ${err.message}`));
    } catch (err) {
      argoLogBuffer.push(`[sing-box 启动异常] ${err.message}`);
    }
  }

  // 校验并启动 Cloudflare Argo
  if (!fs.existsSync(CF_PATH)) {
    argoLogBuffer.push(`[错误] 无法启动 cloudflared: 文件不存在`);
  } else {
    try {
      const argo = spawn(CF_PATH, [
        'tunnel',
        '--no-autoupdate',
        '--protocol', 'http2',
        '--url', `http://127.0.0.1:${INTERNAL_PORT}`
      ]);

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
      argo.on('error', (err) => argoLogBuffer.push(`[cloudflared 启动失败] ${err.message}`));
    } catch (err) {
      argoLogBuffer.push(`[cloudflared 启动异常] ${err.message}`);
    }
  }
}

process.on('uncaughtException', (err) => console.error('[Uncaught Exception]', err));
process.on('unhandledRejection', (reason) => console.error('[Unhandled Rejection]', reason));
