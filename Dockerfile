FROM node:18-slim

RUN apt-get update && apt-get install -y curl tar ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 下载 sing-box 并添加执行权限
RUN curl -sL https://github.com/SagerNet/sing-box/releases/download/v1.10.1/sing-box-1.10.1-linux-amd64.tar.gz | tar -xz && \
    mv sing-box-*/sing-box ./sing-box && \
    chmod +x ./sing-box

# 下载 cloudflared 并添加执行权限
RUN curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ./cloudflared && \
    chmod +x ./cloudflared

COPY package.json ./
RUN npm install --production

COPY index.js ./

EXPOSE 3000

CMD ["node", "index.js"]
