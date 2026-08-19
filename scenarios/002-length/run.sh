#!/usr/bin/env bash
# mode: M1
# 002-length — Content-Length を消したとき本文がどうなるか
#
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-002.mjs --scenario=002-length
