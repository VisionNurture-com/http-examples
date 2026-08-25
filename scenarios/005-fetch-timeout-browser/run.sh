#!/usr/bin/env bash
# mode: M2
# 005-fetch-timeout-browser — ブラウザの fetch は何秒待つか
#
# 前提: docker compose up -d --wait / npx playwright install
# 🔴 上限 330 秒まで待つため、1 回の実行に 5 分半かかる。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-005-timeout-browser.mjs
