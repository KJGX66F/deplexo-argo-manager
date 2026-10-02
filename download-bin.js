const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const get = (currentUrl) => {
      const client = currentUrl.startsWith('https') ? https : http;
      client.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP 状态码: ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    };
    get(url);
  });
}

async function main() {
  console.log('[Build] 正在构建阶段拉取二进制核心组件...');
  const cfPath = path.join(__dirname, 'cloudflared');
  const sbPath = path.join(__dirname, 'sing-box');
  const tarPath = path.join(__dirname, 'sing-box.tar.gz');

  // 1. 下载 cloudflared
  if (!fs.existsSync(cfPath)) {
    console.log('[Build] 下载 cloudflared...');
    await downloadFile('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64', cfPath);
  }

  // 2. 下载 sing-box
  if (!fs.existsSync(sbPath)) {
    console.log('[Build] 下载 sing-box...');
    await downloadFile('https://github.com/SagerNet/sing-box/releases/download/v1.10.7/sing-box-1.10.7-linux-amd64.tar.gz', tarPath);
    execSync(`tar -zxvf "${tarPath}" --strip-components=1 */sing-box`, { cwd: __dirname });
    if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
  }

  // 3. 赋予执行权限 chmod +x
  try {
    execSync(`chmod +x "${cfPath}" "${sbPath}"`, { cwd: __dirname });
    console.log('[Build] 组件下载完成并已赋予可执行权限！');
  } catch (e) {
    console.error('[Build] 权限设置异常:', e.message);
  }
}

main().catch(err => {
  console.error('[Build 失败]', err);
  process.exit(1);
});
