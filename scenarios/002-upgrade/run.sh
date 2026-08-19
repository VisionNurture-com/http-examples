#!/usr/bin/env bash
# mode: M1
# 002-upgrade — Upgrade を付けた平文リクエストと、中継での消え方
#
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-002.mjs --scenario=002-upgrade
