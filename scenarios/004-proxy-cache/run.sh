#!/usr/bin/env bash
# mode: M1
# 004-proxy-cache — 前段のキャッシュはコードを見て保存を変えるか
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-004.mjs --scenario=004-proxy-cache
