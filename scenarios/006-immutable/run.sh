#!/usr/bin/env bash
# mode: M2
# 006-immutable — immutable は今も効くのか
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# nginx にログを開き直させる。コンテナを動かしたままログを置き換えると nginx は
# 削除済み inode へ書き続け、到着記録が届かなくなる。
docker compose exec -T edge nginx -s reopen

# 3 エンジン分を測る。分離コンテキストと永続プロファイルの両方を取る。
node tools/measure-006-cache.mjs --scenario=006-immutable --browser=chromium
node tools/measure-006-cache.mjs --scenario=006-immutable --browser=firefox
node tools/measure-006-cache.mjs --scenario=006-immutable --browser=webkit

# 分離コンテキストがメモリキャッシュのみになっている可能性を潰すための対照
node tools/measure-006-cache.mjs --scenario=006-immutable --browser=chromium --persistent

node tools/aggregate-006.mjs 006-immutable
