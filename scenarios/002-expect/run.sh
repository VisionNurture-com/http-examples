#!/usr/bin/env bash
# mode: M1
# 002-expect — 自分では書いていない Expect: 100-continue が現れる大きさ
#
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-002.mjs --scenario=002-expect
