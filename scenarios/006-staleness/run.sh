#!/usr/bin/env bash
# mode: M2
# 006-staleness — 直したのに反映されない
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# nginx にログを開き直させる。コンテナを動かしたままログを置き換えると nginx は
# 削除済み inode へ書き続け、到着記録が届かなくなる。
docker compose exec -T edge nginx -s reopen

# 差し替え対象は git 管理外の生成物（public/006/gen/）。追跡ファイルは書き換えない。
node tools/measure-006-staleness.mjs
node tools/aggregate-006.mjs 006-staleness
