#!/bin/sh


mkdir -p .data



# 自动UUID

if [ ! -f .data/uuid ];then

cat /proc/sys/kernel/random/uuid > .data/uuid

fi


UUID=$(cat .data/uuid)



echo "UUID:"
echo $UUID



# 下载 sing-box

if [ ! -f sing-box ];then


wget -q \
https://github.com/SagerNet/sing-box/releases/latest/download/sing-box-linux-amd64.tar.gz


tar xf sing-box-linux-amd64.tar.gz


mv sing-box*/sing-box sing-box


chmod +x sing-box


fi



cat > config.json <<EOF
{
"log":{
"level":"info"
},

"inbounds":[

{
"type":"vless",

"listen":"0.0.0.0",

"listen_port":3000,

"users":[
{
"uuid":"$UUID"
}
],

"transport":{
"type":"ws",
"path":"/argo"
}

}

],

"outbounds":[
{
"type":"direct"
}
]

}
EOF



./sing-box run -c config.json &



sleep 3



echo "Sing-box started"



# Argo临时隧道

wget -q \
https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
-O cloudflared


chmod +x cloudflared



./cloudflared tunnel \
--no-autoupdate \
--protocol auto \
--url http://127.0.0.1:3000 \
> argo.log 2>&1 &



sleep 8



ARGO=$(grep -o "https://[-a-z0-9]*\.trycloudflare.com" argo.log | head -1)



echo "节点地址:"
echo $ARGO



cat > sub.txt <<EOF

vless://$UUID@$ARGO:443?security=tls&type=ws&path=%2Fargo#$ARGO

EOF



node index.js
