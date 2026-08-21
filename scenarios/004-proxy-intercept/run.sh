#!/usr/bin/env bash
# mode: M1
# 004-proxy-intercept — 本文へ書いた詳細（RFC 9457）が経路の途中で残るか消えるか
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-004.mjs --scenario=004-proxy-intercept
