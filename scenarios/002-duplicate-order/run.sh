#!/usr/bin/env bash
# mode: M1
# 002-duplicate-order — 同名ヘッダの重複と並びの入れ替え（生ソケットで組む）
#
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-002.mjs --scenario=002-duplicate-order
