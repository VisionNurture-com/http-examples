#!/usr/bin/env bash
# mode: M2
# 006-navigation — リロードと「戻る」で扱いが変わるか
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# nginx にログを開き直させる。コンテナを動かしたままログを置き換えると nginx は
# 削除済み inode へ書き続け、到着記録が届かなくなる。
docker compose exec -T edge nginx -s reopen

for b in chromium firefox webkit; do
  node tools/measure-006-cache.mjs --scenario=006-navigation --browser=$b
done
# 「戻る」は自動化できない。results/006-navigation/bfcache-manual.json を参照。
node tools/aggregate-006.mjs 006-navigation
