#!/usr/bin/env bash
# mode: M1
# 009-header-arrival — 既定で Authorization を落とす構成はどれか
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

curl --silent --show-error --max-time 10 -X POST http://localhost:8080/009/api/__reset
node tools/measure-009-arrival.mjs
