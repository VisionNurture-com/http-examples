#!/usr/bin/env bash
# mode: M2
# 002-minimize — ブラウザが送るヘッダを 1 本ずつ削って、結果が変わる点を探す
#
# 実ブラウザ 3 エンジンの採取を先に済ませること（CI では回らない）:
#
#   node tools/capture-002-browser.mjs
#
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# 採取が無ければ落ちる。測定側が先に走ると baseline が固定できない
node tools/measure-002.mjs --scenario=002-minimize
