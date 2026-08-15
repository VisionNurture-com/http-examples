#!/usr/bin/env bash
# set-h3buf.sh — http3_stream_buffer_size を切り替えて nginx を reload する
#
# 011 の測定では「サーバ側のストリームバッファが HTTP/3 の上限を決める」ことを見る。
# 手で nginx.conf を編集すると測定条件の記録が曖昧になるため、切り替えを 1 本のスクリプトに閉じる。
#
# 使い方:
#   sudo bash set-h3buf.sh 64k     # 既定（ディレクティブを書かない状態＝ nginx 既定の 64k）
#   sudo bash set-h3buf.sh 256k
#   sudo bash set-h3buf.sh 4m

set -euo pipefail

VAL="${1:?64k|256k|1m|4m}"
CONF=/etc/nginx/nginx-011.conf
NS=srv

[ -f "$CONF" ] || { echo "$CONF がない。先に setup-011.sh を実行すること" >&2; exit 3; }

# 既存行を消してから入れ直す（多重挿入を防ぐ）
sed -i '/http3_stream_buffer_size/d' "$CONF"

if [ "$VAL" != "64k" ]; then
  # http ブロック内の既知の行の後ろへ差し込む
  sed -i "/http2_max_concurrent_streams/a\\    http3_stream_buffer_size ${VAL};" "$CONF"
fi

nginx -t -c "$CONF" 2>&1 | tail -1
ip netns exec "$NS" nginx -c "$CONF" -s reload
sleep 1

CUR=$(grep -o 'http3_stream_buffer_size[^;]*' "$CONF" || true)
echo "[set-h3buf] 設定: ${CUR:-（未指定 = nginx 既定の 64k）}"
ip netns exec "$NS" ss -lntu | grep -c ':443' | sed 's/^/[set-h3buf] listen: /'
