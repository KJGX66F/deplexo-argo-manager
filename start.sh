#!/bin/sh


UUID=$(cat /proc/sys/kernel/random/uuid)


sed "s/UUID/$UUID/" config.json > sb.json


sing-box run -c sb.json &


sleep 2


cloudflared tunnel \
--no-autoupdate \
--protocol auto \
--url http://127.0.0.1:3000
