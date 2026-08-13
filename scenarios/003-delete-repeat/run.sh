#!/usr/bin/env bash
# mode: M1
# 003-delete-repeat — 2 回目の DELETE で状態と応答がそれぞれどうなるか（ブラウザ不要・curl のみ）
#
# 測るもの:
#   ① 存在を確かめてから消す実装 / ② 確かめずに消す実装 / ③ 結果を本文で返す実装
#   それぞれについて「状態が同じか」と「応答が同じか」を別々に記録する
#
# 🔴 このシナリオは「冪等 = 応答が同じ」ではないことを分けて示すためにある。
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose exec -T edge nginx -s reopen

node tools/measure-003.mjs --scenario=003-delete-repeat
