#!/usr/bin/env bash
# mode: M1
# 007-content-type-parse — 型が合わないボディを送ったとき、経路上の誰が止めるかを測る
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node tools/measure-007-parse.mjs
