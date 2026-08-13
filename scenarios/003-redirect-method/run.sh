#!/usr/bin/env bash
# mode: M1
# 003-redirect-method — 301〜308 でメソッドとボディがどうなるか（クライアント = curl）
#
# 測るもの:
#   5 つのステータス × 3 通りの書き方
#     implicit … -d だけ（メソッドは curl が決める）
#     forced   … -X POST を足す（記事でよく見る書き方）
#     post30x  … --post301 / --post302 / --post303 で変換をやめさせる
#
# 🔴 サーバ側が決めるのは「どのステータスを返すか」だけで、メソッドをどう扱うかは
#    クライアントの判断。だからクライアントの書き方ごとに測る必要がある。
# 🔴 判定は転送先の到着記録（method と本文の長さ）で行う。curl の申告では読まない。
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose exec -T edge nginx -s reopen

node tools/measure-003.mjs --scenario=003-redirect-method
