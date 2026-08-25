#!/usr/bin/env bash
# mode: M1
# 005-idempotency-compliance — 冪等キーを付けたのに二重登録が起きる境界
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

curl --silent --show-error --max-time 10 -X POST http://localhost:8086/005/__reset
node tools/measure-005-idempotency.mjs
