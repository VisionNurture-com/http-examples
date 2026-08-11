#!/usr/bin/env bash
# mode: M1
# 006-proxy-cache — 共有キャッシュは private をどう扱うか
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

curl -sS -X POST http://localhost:8084/006/api/hits/reset > /dev/null
node tools/measure-006-headers.mjs --scenario=006-proxy-cache
node tools/aggregate-006.mjs 006-proxy-cache
