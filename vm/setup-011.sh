#!/usr/bin/env bash
# setup-011.sh — 記事 011（HTTP/3）の M3 測定トポロジを作る
#
#   root netns（クライアント: /opt/curl-h3/bin/curl）
#      veth-h 10.11.0.1/24
#         │  netem はここに「上り」を当てる
#      veth-s 10.11.0.2/24
#   netns "srv"（サーバ: apt 版 nginx --with-http_v3_module）
#         netem はここに「下り（rate / loss）」を当てる
#
# 測定が歪まないよう、最初から織り込んであること:
#   - 整形インタフェースのオフロード（GSO/GRO/TSO）を切る
#   - nginx の fd 上限を worker_connections に見合う値まで上げる
#   - 高帯域側を上から詰めるため 100 MiB のファイルを置く

set -euo pipefail

NS=srv
HOST_IF=veth-h
NS_IF=veth-s
HOST_IP=10.11.0.1
NS_IP=10.11.0.2

echo "[1/6] 既存トポロジの撤去"
sudo ip netns del "$NS" 2>/dev/null || true
sudo ip link del "$HOST_IF" 2>/dev/null || true

echo "[2/6] netns と veth の作成"
sudo ip netns add "$NS"
sudo ip link add "$HOST_IF" type veth peer name "$NS_IF"
sudo ip link set "$NS_IF" netns "$NS"
sudo ip addr add "$HOST_IP/24" dev "$HOST_IF"
sudo ip link set "$HOST_IF" up
sudo ip netns exec "$NS" ip addr add "$NS_IP/24" dev "$NS_IF"
sudo ip netns exec "$NS" ip link set "$NS_IF" up
sudo ip netns exec "$NS" ip link set lo up

echo "[3/6] オフロードを両端で停止（netem をパケット単位で働かせる）"
sudo ethtool -K "$HOST_IF" gso off gro off tso off >/dev/null 2>&1 || true
sudo ip netns exec "$NS" ethtool -K "$NS_IF" gso off gro off tso off >/dev/null 2>&1 || true
echo "  $HOST_IF: $(ethtool -k $HOST_IF | grep -E '^(generic-segmentation|generic-receive|tcp-segmentation)-offload' | tr '\n' ' ')"
echo "  $NS_IF : $(sudo ip netns exec $NS ethtool -k $NS_IF | grep -E '^(generic-segmentation|generic-receive|tcp-segmentation)-offload' | tr '\n' ' ')"

echo "[4/6] 証明書と配信ファイル"
sudo mkdir -p /etc/nginx/certs-011
sudo openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /etc/nginx/certs-011/server.key -out /etc/nginx/certs-011/server.crt \
  -days 365 -subj "/CN=h3.example" -addext "subjectAltName=DNS:h3.example,IP:${NS_IP}" 2>/dev/null
sudo mkdir -p /srv/probe/many
for spec in 100k:100 1m:1024 5m:5120 20m:20480 100m:102400; do
  name="${spec%%:*}"; kb="${spec##*:}"
  [ -f "/srv/probe/${name}.bin" ] || sudo dd if=/dev/urandom of="/srv/probe/${name}.bin" bs=1024 count="$kb" status=none
done
for i in $(seq -w 1 100); do
  [ -f "/srv/probe/many/o${i}.bin" ] || sudo dd if=/dev/urandom of="/srv/probe/many/o${i}.bin" bs=1024 count=10 status=none
done
echo "  $(ls /srv/probe/*.bin | wc -l) 個のサイズ別ファイル / many = $(ls /srv/probe/many | wc -l) 個"

echo "[5/6] nginx の設定"
sudo tee /etc/nginx/nginx-011.conf >/dev/null <<'CONF'
# 011 の M3 測定用。apt 版 nginx（--with-http_v3_module）で 3 プロトコルを同時に出す。
worker_processes     2;
worker_rlimit_nofile 65535;
error_log  /var/log/nginx/011-error.log warn;
pid        /run/nginx-011.pid;

events { worker_connections 4096; }

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    access_log    off;
    sendfile      on;
    tcp_nopush    on;

    # 多重化の効果が上限で頭打ちにならないよう既定 128 から引き上げる
    http2_max_concurrent_streams 256;

    server {
        listen 443 ssl reuseport;      # HTTP/1.1 と HTTP/2（TCP）
        listen 443 quic reuseport;     # HTTP/3（UDP）
        http2 on;
        http3 on;

        server_name h3.example;

        ssl_certificate     /etc/nginx/certs-011/server.crt;
        ssl_certificate_key /etc/nginx/certs-011/server.key;
        ssl_protocols       TLSv1.2 TLSv1.3;
        ssl_early_data      off;       # 0-RTT が測定を汚さないよう固定する

        add_header Alt-Svc 'h3=":443"; ma=86400' always;
        add_header X-Observed-Protocol $server_protocol always;

        location / { root /srv/probe; autoindex on; }
    }
}
CONF
sudo nginx -t -c /etc/nginx/nginx-011.conf 2>&1 | tail -1

echo "[6/6] netns 内で nginx を起動し疎通を確認"
sudo ip netns exec "$NS" bash -c 'ulimit -n 65535; nginx -c /etc/nginx/nginx-011.conf'
sleep 1
echo "  listen: $(sudo ip netns exec $NS ss -lntu | grep -c ':443') 本"
C=/opt/curl-h3/bin/curl
for proto in http1.1 http2 http3-only; do
  echo "  --$proto -> $($C -sk --resolve h3.example:443:${NS_IP} --${proto} -o /dev/null \
    -w '%{http_version} %{http_code}' https://h3.example/100k.bin)"
done
echo "[done]"
