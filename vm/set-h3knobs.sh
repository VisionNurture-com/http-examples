#!/usr/bin/env bash
# set-h3knobs.sh — 高 RTT × 太い回線で HTTP/3 が TCP に届かない条件の追試用に、
#                  サーバ側の 3 つのつまみをまとめて切り替えて nginx を reload する
#
# 由来: nginx/nginx#217（https://github.com/nginx/nginx/issues/217）のコメントで
#   「tc で遅延を足した経路では次の組み合わせで改善した」と報告されている。
#       http3_stream_buffer_size 1024k;
#       quic_gso on;
#       ssl_buffer_size 4k;          # "Needs to be small for h3"
#   記事 011 は http3_stream_buffer_size しか振っていないため、残る 2 つが
#   効くかどうかを同じトポロジで確かめる。報告をそのまま書かないための実測。
#
# 使い方:
#   sudo bash set-h3knobs.sh 4m    default off   # 記事 sec03 の 4m 行と同じ状態（基準）
#   sudo bash set-h3knobs.sh 4m    4k      off   # ssl_buffer_size だけを足す
#   sudo bash set-h3knobs.sh 1024k 4k      on    # #217 で報告された組み合わせ
#
# 注意: set-h3buf.sh と同じ conf を触る。両方を混ぜて使わないこと。

set -euo pipefail

BUF="${1:?64k|256k|1m|1024k|4m}"
SSLBUF="${2:?default|4k|16k}"
GSO="${3:?on|off|default}"
CONF=/etc/nginx/nginx-011.conf
NS=srv
ANCHOR='http2_max_concurrent_streams'

[ -f "$CONF" ] || { echo "$CONF がない。先に setup-011.sh を実行すること" >&2; exit 3; }

# 3 行とも一度消してから入れ直す（多重挿入を防ぐ）
sed -i "/http3_stream_buffer_size/d; /ssl_buffer_size/d; /quic_gso/d" "$CONF"

[ "$BUF"    = "64k"     ] || sed -i "/$ANCHOR/a\\    http3_stream_buffer_size ${BUF};" "$CONF"
[ "$SSLBUF" = "default" ] || sed -i "/$ANCHOR/a\\    ssl_buffer_size ${SSLBUF};"        "$CONF"
[ "$GSO"    = "default" ] || sed -i "/$ANCHOR/a\\    quic_gso ${GSO};"                  "$CONF"

nginx -t -c "$CONF" 2>&1 | tail -1
ip netns exec "$NS" nginx -c "$CONF" -s reload
sleep 1

echo "[set-h3knobs] 実際に conf へ入っている行:"
grep -nE 'http3_stream_buffer_size|ssl_buffer_size|quic_gso' "$CONF" | sed 's/^/  /' \
  || echo "  （3 つとも未指定 = nginx 既定）"
ip netns exec "$NS" ss -lntu | grep -c ':443' | sed 's/^/[set-h3knobs] listen: /'
