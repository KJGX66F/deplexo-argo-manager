FROM alpine:latest

WORKDIR /app


RUN apk add --no-cache \
wget \
curl \
bash \
unzip


# 下载 sing-box
RUN wget -O sing-box.tar.gz \
https://github.com/SagerNet/sing-box/releases/latest/download/sing-box-linux-amd64.tar.gz \
&& tar -xzvf sing-box.tar.gz \
&& mv sing-box-*/sing-box /usr/local/bin/sing-box


# cloudflared
RUN wget -O /usr/local/bin/cloudflared \
https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
&& chmod +x /usr/local/bin/cloudflared


COPY . .


CMD ["bash","start.sh"]
