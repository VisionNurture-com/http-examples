#!/usr/bin/env bash
# mode: M1
# 006-expires-directive — nginx の expires が実際に出すヘッダ
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-006-headers.mjs --scenario=006-expires-directive
node tools/aggregate-006.mjs 006-expires-directive
