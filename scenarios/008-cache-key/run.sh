#!/usr/bin/env bash
# mode: M2
# 008-cache-key — preflight キャッシュの鍵の粒度を 3 エンジンで測る
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# nginx にログを開き直させる。コンテナを動かしたままログを置き換えると nginx は
# 削除済み inode へ書き続け、到着記録が届かなくなる（全ケースが偽の「preflight なし」になる）。
docker compose exec -T edge nginx -s reopen

# 3 エンジン分を 1 本の run.log にまとめる（先に消す）
mkdir -p results/008-cache-key
rm -f results/008-cache-key/run.log

node tools/measure-008-cache-key.mjs --browser=chromium
node tools/measure-008-cache-key.mjs --browser=firefox
node tools/measure-008-cache-key.mjs --browser=webkit
node tools/aggregate-008-extra.mjs cache-key
