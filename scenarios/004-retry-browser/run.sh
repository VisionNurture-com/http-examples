#!/usr/bin/env bash
# mode: M2
# 004-retry-browser — ブラウザの fetch は 429 + Retry-After で再送するか
#
# 各エンジンで Retry-After の 3 倍だけ待って到着を数える（実行に約 30 秒）。
#
# 前提: docker compose up -d --wait / npx playwright install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/capture-004-browser.mjs --scenario=004-retry-browser
