#!/usr/bin/env bash
# mode: M1
# 012-brotli-types — brotli_types の重複警告を実物のログで確かめる
#
# 🔴 公式 nginx には Brotli モジュールが無い。Alpine の配布パッケージから版を固定して組む。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
docker build -q -t http-examples-brotli:1.28.3-r7 brotli/ >/dev/null
node tools/measure-012-brotli-types.mjs
