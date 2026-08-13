#!/usr/bin/env bash
# mode: M1
# 003-safe-get — 状態を変える GET を HEAD が踏むか（ブラウザ不要・curl のみ）
#
# 測るもの:
#   ① GET を 3 回送ったときの消費数
#   ② HEAD を 1 回送ったときの消費数（app.get() のハンドラに落ちるか）
#   ③ 対照として、本当に読むだけの GET が状態を動かさないこと
#
# 🔴 ②は自分では 1 行も書いていない経路。ここが「GET は安全」という言い方の
#    実際を測る中心になる（自作の危険な GET を自分で確かめる循環を避けるため）。
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose exec -T edge nginx -s reopen

node tools/measure-003.mjs --scenario=003-safe-get
