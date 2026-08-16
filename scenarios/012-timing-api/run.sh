#!/usr/bin/env bash
# mode: M0
# 012-timing-api — Resource Timing の属性は実装に存在するか
#
# 前提: なし（docker もサーバも要らない。ブラウザの API 表面だけを見る）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/probe-012-timing-api.mjs
node tools/aggregate-012.mjs timing-api
