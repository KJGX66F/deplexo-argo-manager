#!/bin/bash


echo "启动 sing-box"


sing-box run \
-c config.json &



sleep 3


echo "启动 Cloudflare Argo"


cloudflared tunnel \
--no-autoupdate \
--protocol auto \
--url http://127.0.0.1:3000
