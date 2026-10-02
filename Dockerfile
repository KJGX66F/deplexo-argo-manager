FROM alpine:latest

WORKDIR /app


RUN apk add --no-cache \
bash \
wget \
curl \
openssl \
jq \
tar


# 安装 sing-box
RUN wget -O sing-box.tar.gz \
https://github.com/SagerNet/sing-box/releases/latest/download/sing-box-linux-amd64.tar.gz \
&& tar -xzf sing-box.tar.gz \
&& mv sing-box-*/sing-box /usr/local/bin/sing-box


# 安装 cloudflared
RUN wget -O /usr/local/bin/cloudflared \
https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
&& chmod +x /usr/local/bin/cloudflared


COPY . .


RUN chmod +x start.sh


CMD ["./start.sh"]
