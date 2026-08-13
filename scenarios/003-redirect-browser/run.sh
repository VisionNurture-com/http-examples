#!/usr/bin/env bash
# mode: M2
# 003-redirect-browser — 301〜308 をブラウザの fetch が追ったときのメソッドとボディ
#
# 測るもの: 同一オリジンの fetch で POST を出し、転送先に何が届くかを 3 エンジンで比べる。
#           curl 側（003-redirect-method）と揃えて読むための対になるシナリオ。
#
# 前提: docker compose up -d --wait / npx playwright install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose exec -T edge nginx -s reopen

node tools/measure-003-browser.mjs --scenario=003-redirect-browser
