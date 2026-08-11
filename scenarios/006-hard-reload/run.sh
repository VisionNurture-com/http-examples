#!/usr/bin/env bash
# mode: M2
# 006-hard-reload — 通常リロードとハードリロードで扱いが変わるか
#
# 前提: docker compose up -d --wait
#       macOS のアクセシビリティ許可（/usr/bin/osascript）
#
# ⚠️ GUI 操作を伴うため CI では回らない。実行中はブラウザが前面に出る。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose exec -T edge nginx -s reopen

node tools/measure-006-hard-reload.mjs
node tools/aggregate-006.mjs 006-hard-reload
