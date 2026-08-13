#!/usr/bin/env bash
# mode: M2
# 003-method-override — form が実際にワイヤへ送るメソッド（実ブラウザ 3 エンジン）
#
# 測るもの:
#   ① POST + _method=PUT（広く使われる偽装）がワイヤに何を出し、どのハンドラに届くか
#   ② HTML の method 属性に PUT と書いたときに何が出るか
#   ③④ 対照としてふつうの POST と GET
#   ⑤ 対照として fetch の本物の PUT
#
# 🔴 fetch では代用できない。測っているのは「ブラウザが form をどう送るか」なので、
#    実際に submit してナビゲーションを起こす必要がある。
#
# 前提: docker compose up -d --wait / npx playwright install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose exec -T edge nginx -s reopen

node tools/measure-003-browser.mjs --scenario=003-method-override
