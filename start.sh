#!/bin/bash


echo "================================"
echo "Sing-box Argo VLESS启动"
echo "================================"



# 自动生成UUID

UUID=$(cat /proc/sys/kernel/random/uuid)



echo ""
echo "生成UUID:"
echo $UUID
echo ""



# 生成配置

sed \
"s/UUID_PLACEHOLDER/$UUID/g" \
config.template.json \
> config.json



echo "sing-box配置完成"



# 启动sing-box

sing-box run \
-c config.json &



sleep 3



echo ""
echo "启动Cloudflare Tunnel"
echo ""



cloudflared tunnel \
--no-autoupdate \
--protocol auto \
--url http://127.0.0.1:3000
