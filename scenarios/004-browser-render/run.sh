#!/usr/bin/env bash
# mode: M2
# 004-browser-render — ブラウザはコードで描画を変えるか（3 エンジン・CI では回らない）
#
# 前提: docker compose up -d --wait / npx playwright install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/capture-004-browser.mjs --scenario=004-browser-render
