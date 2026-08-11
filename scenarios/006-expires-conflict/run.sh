#!/usr/bin/env bash
# mode: M2
# 006-expires-conflict — expires と add_header Cache-Control がぶつかったら
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# nginx にログを開き直させる。コンテナを動かしたままログを置き換えると nginx は
# 削除済み inode へ書き続け、到着記録が届かなくなる。
docker compose exec -T edge nginx -s reopen

node tools/measure-006-headers.mjs --scenario=006-expires-conflict
for b in chromium firefox webkit; do
  node tools/measure-006-cache.mjs --scenario=006-expires-conflict --browser=$b
done
node tools/aggregate-006.mjs 006-expires-conflict
