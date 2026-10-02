FROM node:18-slim

# 安装必要依赖
RUN apt-get update && apt-get install -y curl tar ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 预先下载 sing-box 和 cloudflared
RUN curl -sL https://github.com/SagerNet/sing-box/releases/download/v1.10.1/sing-box-1.10.1-linux-amd64.tar.gz | tar -xz && \
    mv sing-box-*/sing-box ./sing-box && \
    chmod +x ./sing-box

RUN curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ./cloudflared && \
    chmod +x ./cloudflared

COPY package.json ./
RUN npm install

COPY index.js ./

EXPOSE 3000

CMD ["node", "index.js"]
