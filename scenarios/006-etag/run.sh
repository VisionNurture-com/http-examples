#!/usr/bin/env bash
# mode: M1
# 006-etag — no-cache のときに何が起きるか
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-006-headers.mjs --scenario=006-etag
node tools/aggregate-006.mjs 006-etag
