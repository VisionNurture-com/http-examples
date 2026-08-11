#!/usr/bin/env bash
# mode: M2
# 008-preflight-boundary — preflight の発生境界を 3 ブラウザで測る
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# nginx にログを開き直させる。コンテナを動かしたままログを置き換えると nginx は
# 削除済み inode へ書き続け、到着記録が届かなくなる（全ケースが偽の「preflight なし」になる）。
docker compose exec -T edge nginx -s reopen

node tools/measure-preflight-boundary.mjs --browser=chromium
node tools/measure-preflight-boundary.mjs --browser=firefox
node tools/measure-preflight-boundary.mjs --browser=webkit
node tools/aggregate-008.mjs boundary
