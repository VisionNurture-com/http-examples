#!/usr/bin/env bash
# mode: M1
# 002-accept-encoding — Accept-Encoding を削ると 200 のまま中身が変わる
#
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-002.mjs --scenario=002-accept-encoding
