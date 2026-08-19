#!/usr/bin/env bash
# mode: M1
# 002-header-size — ヘッダが大きすぎるとき、どこで弾かれるか
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-002.mjs --scenario=002-header-size
