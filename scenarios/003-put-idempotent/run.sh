#!/usr/bin/env bash
# mode: M1
# 003-put-idempotent — 同じ PUT を 3 回送ったときサーバ状態がどう動くか（ブラウザ不要・curl のみ）
#
# 測るもの:
#   ① 完全置換 / ② 更新時刻をサーバで打つ / ③ 追記 / ④ 採番 の 4 系統
#   ⑤ 陽性対照として POST（毎回作る実装）
#   ⑥ 反復を nginx と Express が拒むかどうか
#
# 🔴 判定はサーバ状態（GET /003/state）で行う。応答が同じかどうかでは冪等性を判定しない。
# 🔴 状態はプロセス内に残るため、系統ごとに POST /003/__reset で初期化する。
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# 動かしたままログを置き換えると nginx は削除済み inode へ書き続ける。開き直させる。
docker compose exec -T edge nginx -s reopen

node tools/measure-003.mjs --scenario=003-put-idempotent
