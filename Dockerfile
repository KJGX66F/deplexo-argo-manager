FROM alpine:3.20

WORKDIR /app

RUN apk add --no-cache bash wget ca-certificates unzip


RUN wget -q https://github.com/SagerNet/sing-box/releases/latest/download/sing-box-linux-amd64.tar.gz \
&& tar -xzf sing-box-linux-amd64.tar.gz \
&& mv sing-box-*/sing-box /usr/bin/sing-box


RUN wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
-o /usr/bin/cloudflared \
&& chmod +x /usr/bin/cloudflared


COPY . .

RUN chmod +x start.sh


CMD ["./start.sh"]
