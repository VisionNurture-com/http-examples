#!/usr/bin/env bash
# measure-011-mux.sh — カード② 多重化 vs HTTP/1.1
#
# 4 モードを比べる:
#   h1-seq   HTTP/1.1・1 接続で順番に取る（多重化なしの素の姿）
#   h1-par6  HTTP/1.1・6 並列接続（ブラウザが昔からやっていること）
#   h2       HTTP/2・1 接続に多重化
#   h3       HTTP/3・1 接続に多重化
#
# 判定は「全部そろうまでの実時間」。1 本ずつの速度ではなく、
# 画面が出るまでに何秒かかるかが読者の関心事のため。
#
# 使い方: sudo bash measure-011-mux.sh <cfg_label> <out_dir>
#   環境変数で条件を絞る／ロスを足す:
#     sudo LOSS=1% RTTS=100 NLIST="6 25" TAG=-loss1 bash measure-011-mux.sh 64k /home/ubuntu/results-011-mux

set -uo pipefail
CFG="${1:?64k|4m}"
OUT="${2:-/home/ubuntu/results-011-mux}"
mkdir -p "$OUT"

C=/opt/curl-h3/bin/curl
NS=srv; HIF=veth-h; SIF=veth-s
HOST=h3.example; IP=10.11.0.2
RATE=100mbit
REPEAT=3

# 環境変数で条件を絞る／ロスを足す（既定は初回測定と同じ条件のまま）
LOSS="${LOSS:-0%}"          # ロス下の多重化を測るときだけ 1% 等を渡す
RTTS="${RTTS:-20 100}"      # 測る RTT（ms）
NLIST="${NLIST:-6 25 100}"  # 測るオブジェクト個数
TAG="${TAG:-}"              # 出力ファイル名の接尾辞（例: -loss1）

JSONL="$OUT/mux-${CFG}${TAG}.jsonl"; LOG="$OUT/mux-${CFG}${TAG}.log"
: > "$JSONL"; : > "$LOG"
log() { echo "$*" | tee -a "$LOG"; }

. /etc/os-release
log "measured-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "host: multipass ${PRETTY_NAME} / kernel $(uname -r) / $(nproc) vCPU"
log "client: $($C -V | head -1)"
log "server: $(nginx -v 2>&1) / http3_stream_buffer_size=${CFG}"
log "note: M3（手動・CI 対象外）。判定は全オブジェクトが揃うまでの実時間"
log ""

clear_netem() {
  tc qdisc del dev "$HIF" root 2>/dev/null
  ip netns exec "$NS" tc qdisc del dev "$SIF" root 2>/dev/null
  return 0
}

urls() {  # $1 = 個数
  for i in $(seq -w 1 "$1"); do echo "https://${HOST}/many/o${i}.bin"; done
}

for RTT_MS in $RTTS; do
  clear_netem
  LIMIT=$(python3 -c "print(max(2000,int(100000000/8.0*($RTT_MS/1000.0)/1500.0*3)))")
  HALF=$(python3 -c "print(f'{$RTT_MS/2.0:g}ms')")
  # loss は 0% のとき netem へ渡さない（初回測定と同一の qdisc にするため）
  SRV_NETEM=(rate "$RATE" delay "$HALF" limit "$LIMIT")
  [ "$LOSS" != "0%" ] && SRV_NETEM=(rate "$RATE" delay "$HALF" loss "$LOSS" limit "$LIMIT")
  tc qdisc replace dev "$HIF" root netem delay "$HALF" limit "$LIMIT"
  ip netns exec "$NS" tc qdisc replace dev "$SIF" root netem "${SRV_NETEM[@]}"
  log "### rate=${RATE} rtt設定=${RTT_MS}ms loss=${LOSS} limit=${LIMIT}pkt  cfg=${CFG}"
  log "qdisc(veth-s): $(ip netns exec $NS tc qdisc show dev $SIF | head -1)"

  # 実効 RTT
  SAMP=""
  for _ in $(seq 1 10); do
    SAMP="$SAMP $($C -sk --resolve "${HOST}:443:${IP}" --http1.1 -o /dev/null \
      -w '%{time_connect}' "https://${HOST}/many/o001.bin" 2>/dev/null)"
  done
  RTT_EFF=$(python3 -c "
import statistics as st
v=sorted(float(x)*1000 for x in '''$SAMP'''.split() if x)
print('{\"n\":%d,\"min\":%.2f,\"median\":%.2f,\"max\":%.2f}'%(len(v),v[0],st.median(v),v[-1]))")
  log "実効RTT: $RTT_EFF"

  for N in $NLIST; do
    mapfile -t U < <(urls "$N")
    for mode in h1-seq h1-par6 h2 h3; do
      for r in $(seq 1 $REPEAT); do
        case "$mode" in
          h1-seq)  OPTS=(--http1.1) ;;
          h1-par6) OPTS=(--http1.1 --parallel --parallel-max 6) ;;
          h2)      OPTS=(--http2 --parallel --parallel-max 256) ;;
          h3)      OPTS=(--http3-only --parallel --parallel-max 256) ;;
        esac
        S=$(date +%s.%N)
        "$C" -sk --resolve "${HOST}:443:${IP}" "${OPTS[@]}" --max-time 120 \
             -o /dev/null "${U[@]}" >/dev/null 2>&1
        rc=$?
        E=$(date +%s.%N)
        EL=$(python3 -c "print(round($E-$S,4))")
        echo "{\"cfg\":\"$CFG\",\"rate\":\"$RATE\",\"rtt_set_ms\":$RTT_MS,\"rtt_eff\":$RTT_EFF,\"loss\":\"$LOSS\",\"objects\":$N,\"mode\":\"$mode\",\"run\":$r,\"rc\":$rc,\"elapsed_s\":$EL}" >> "$JSONL"
        log "  N=${N} ${mode} run${r} rc=${rc} elapsed=${EL}s"
      done
    done
  done
  log ""
done

clear_netem
log "[done] $JSONL"
