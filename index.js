const crypto = require('crypto');
const nodejsArgo = require('nodejs-argo');

// 如果环境变量未设置 UUID，则使用 crypto.randomUUID() 随机生成一个
const dynamicUuid = process.env.UUID || crypto.randomUUID();
process.env.UUID = dynamicUuid;

console.log('========================================');
console.log(`[Sing-box] 本次运行随机生成的 UUID 为: ${dynamicUuid}`);
console.log('========================================');

// 启动 sing-box + VLESS + Cloudflare 临时隧道服务
nodejsArgo.start();
