#!/usr/bin/env bash
# measure-011.sh — カード① HTTP/2 vs HTTP/3 の交差点
#
# 測定を成立させるために必要だったこと:
#   - netem の limit を BDP から計算して明示する
#   - ハンドシェイク（t_appconnect）と転送（speed）を分けて記録する
#   - 条件ごとに clear → apply → tc qdisc show をログへ落とす
#   - RTT 精度: 設定値でラベルせず、条件ごとに実効 RTT を実測してラベルにする
#
# 使い方: sudo bash measure-011.sh <label> <out_dir>
#   長い条件はプロトコルを分けて回せる（既定は 3 プロトコルを続けて回す）:
#     sudo PROTOS=http3-only TAG=-h3 bash measure-011.sh T2c /home/ubuntu/results-011

set -uo pipefail
LABEL="${1:?T1a|T1b|T1c|T2a|T2b|T2c|T3a|T3b|T3c|T3d|T4|L2|W1|W2}"
OUT="${2:-/home/ubuntu/results-011}"
mkdir -p "$OUT"

C=/opt/curl-h3/bin/curl
NS=srv; HIF=veth-h; SIF=veth-s
HOST=h3.example; IP=10.11.0.2
REPEAT=3; RTT_SAMPLES=15; MAXTIME=90

# 1 ラベルが長くなりすぎる条件（高 RTT × ロスは全ランがタイムアウトしうる）では
# プロトコルを分けて回す。TAG は出力ファイル名の接尾辞。
PROTOS="${PROTOS:-http1.1 http2 http3-only}"
TAG="${TAG:-}"

JSONL="$OUT/crossover-${LABEL}${TAG}.jsonl"
LOG="$OUT/crossover-${LABEL}${TAG}.log"
: > "$JSONL"; : > "$LOG"
log() { echo "$*" | tee -a "$LOG"; }

. /etc/os-release
log "measured-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "host: multipass ${PRETTY_NAME} / kernel $(uname -r) / $(nproc) vCPU"
log "client: $($C -V | head -1)"
log "server: $(nginx -v 2>&1)"
log "note: M3（手動・CI 対象外）。RTT は設定値でなく実効値を記録する"
log "label: $LABEL"
log ""

case "$LABEL" in
  T1a) RATE="10mbit";  CONDS="20:0%:5m 100:0%:5m" ;;
  T1b) RATE="10mbit";  CONDS="20:1%:5m" ;;
  T1c) RATE="10mbit";  CONDS="100:1%:5m" ;;
  T2a) RATE="100mbit"; CONDS="20:0%:20m 100:0%:20m" ;;
  T2b) RATE="100mbit"; CONDS="20:1%:20m" ;;
  T2c) RATE="100mbit"; CONDS="100:1%:20m" ;;
  T3a) RATE="1gbit";   CONDS="5:0%:20m 50:0%:20m" ;;
  T3b) RATE="1gbit";   CONDS="5:0.1%:20m" ;;
  T3c) RATE="1gbit";   CONDS="50:0.1%:20m" ;;
  T3d) RATE="1gbit";   CONDS="20:0%:20m 20:0.1%:20m" ;;
  T4)  RATE="none";    CONDS="0:0%:100m" ;;
  # ロス率スイープ用（100mbit / RTT 20ms）。0% は T2a・1% は T2b が持つため中間 2 段を足す
  L2)  RATE="100mbit"; CONDS="20:0.1%:20m 20:0.5%:20m" ;;
  # フロー制御ウィンドウ仮説の検証用（T1a の 2 条件目と同一条件）
  W1)  RATE="10mbit";  CONDS="100:0%:5m" ;;
  W2)  RATE="100mbit"; CONDS="100:0%:20m" ;;
  *) echo "unknown label: $LABEL" >&2; exit 3 ;;
esac

clear_netem() {
  tc qdisc del dev "$HIF" root 2>/dev/null
  ip netns exec "$NS" tc qdisc del dev "$SIF" root 2>/dev/null
  return 0
}

# 実効 RTT を TCP ハンドシェイクで測る（ping はユーザ空間の揺らぎを拾いすぎる）
measure_rtt() {
  local samples=""
  for _ in $(seq 1 $RTT_SAMPLES); do
    samples="$samples $($C -sk --resolve "${HOST}:443:${IP}" --http1.1 --max-time 30 \
      -o /dev/null -w '%{time_connect}' "https://${HOST}/100k.bin" 2>/dev/null)"
  done
  python3 -c "
import sys,statistics as st
v=sorted(float(x)*1000 for x in '''$samples'''.split() if x)
if not v: print('{\"n\":0}'); sys.exit()
def p(q):
    i=min(len(v)-1,int(round(q*(len(v)-1))))
    return round(v[i],2)
print('{\"n\":%d,\"min\":%.2f,\"median\":%.2f,\"p90\":%.2f,\"max\":%.2f}' %
      (len(v), v[0], st.median(v), p(0.9), v[-1]))"
}

for cond in $CONDS; do
  RTT_MS="${cond%%:*}"; rest="${cond#*:}"
  LOSS="${rest%%:*}"; OBJ="${rest##*:}"
  clear_netem

  if [ "$RATE" = "none" ]; then
    LIMIT="-"
    log "### 条件: 無整形 / object=${OBJ}.bin"
  else
    RATE_BPS=$(echo "$RATE" | sed 's/gbit/000000000/; s/mbit/000000/')
    LIMIT=$(python3 -c "
bdp=$RATE_BPS/8.0*($RTT_MS/1000.0); print(max(2000,int(bdp/1500.0*3)))")
    HALF=$(python3 -c "print(f'{$RTT_MS/2.0:g}ms')")
    tc qdisc replace dev "$HIF" root netem delay "$HALF" limit "$LIMIT"
    ip netns exec "$NS" tc qdisc replace dev "$SIF" root \
      netem rate "$RATE" delay "$HALF" loss "$LOSS" limit "$LIMIT"
    log "### 条件: rate=${RATE} rtt設定=${RTT_MS}ms loss=${LOSS} object=${OBJ}.bin limit=${LIMIT}pkt"
  fi
  log "qdisc(veth-h): $(tc qdisc show dev $HIF | head -1)"
  log "qdisc(veth-s): $(ip netns exec $NS tc qdisc show dev $SIF | head -1)"

  RTT_EFF=$(measure_rtt)
  log "実効RTT(TCPハンドシェイク ${RTT_SAMPLES}回・ms): $RTT_EFF"

  for proto in $PROTOS; do
    for i in $(seq 1 $REPEAT); do
      FMT='{"http_version":"%{http_version}","code":%{http_code},"size":%{size_download},"speed_bps":%{speed_download},"t_connect":%{time_connect},"t_appconnect":%{time_appconnect},"t_starttransfer":%{time_starttransfer},"t_total":%{time_total}}'
      res=$("$C" -sk --resolve "${HOST}:443:${IP}" "--${proto}" --max-time "$MAXTIME" \
            -o /dev/null -w "$FMT" "https://${HOST}/${OBJ}.bin" 2>/dev/null); rc=$?
      [ $rc -ne 0 ] || [ -z "$res" ] && res='{"http_version":"-","code":0,"size":0,"speed_bps":0,"t_connect":0,"t_appconnect":0,"t_starttransfer":0,"t_total":0}'
      echo "{\"label\":\"$LABEL\",\"rate\":\"$RATE\",\"rtt_set_ms\":$RTT_MS,\"rtt_eff\":$RTT_EFF,\"loss\":\"$LOSS\",\"object\":\"$OBJ\",\"limit\":\"$LIMIT\",\"proto\":\"$proto\",\"run\":$i,\"curl_rc\":$rc,\"m\":$res}" >> "$JSONL"
      log "  $proto run$i rc=$rc $res"
    done
  done
  log ""
done

clear_netem
log "### netem 撤去後: $(tc qdisc show dev $HIF | head -1)"
log "[done] $JSONL"
