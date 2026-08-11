#!/usr/bin/env bash
# netem.sh — M3（Multipass VM）で回線条件を振る
#
# compose では測れないもの: 帯域・RTT・パケットロスを制御した測定、
# UDP の GRO 有無に起因するカーネル受信呼び出し数、HTTP/2 と HTTP/3 の交差点。
#
# 使い方:
#   sudo bash vm/netem.sh apply eth0 100mbit 20ms 0.1%
#   sudo bash vm/netem.sh clear eth0

set -euo pipefail

ACTION="${1:?apply | clear}"
IFACE="${2:?インタフェース名（例: eth0）}"

case "$ACTION" in
  apply)
    RATE="${3:?帯域（例: 100mbit）}"
    DELAY="${4:?片道遅延（例: 20ms）}"
    LOSS="${5:-0%}"
    tc qdisc replace dev "$IFACE" root netem rate "$RATE" delay "$DELAY" loss "$LOSS"
    echo "[netem] applied: rate=$RATE delay=$DELAY loss=$LOSS on $IFACE"
    ;;
  clear)
    tc qdisc del dev "$IFACE" root 2>/dev/null || true
    echo "[netem] cleared on $IFACE"
    ;;
  *)
    echo "unknown action: $ACTION" >&2
    exit 2
    ;;
esac

echo "[netem] current:"
tc qdisc show dev "$IFACE"
