#!/usr/bin/env bash
# mode: M2
# 004-auth-browser — 401 の 5 アームを fetch とナビゲーションの両方から見る
#
# 前提: docker compose up -d --wait / npx playwright install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/capture-004-browser.mjs --scenario=004-auth-browser
