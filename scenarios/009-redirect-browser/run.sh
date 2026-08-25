#!/usr/bin/env bash
# mode: M2
# 009-redirect-browser — オリジンの境界はどこで切れるか（実ブラウザ 3 エンジン）
#
# 前提: docker compose up -d --wait / npx playwright install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-009-redirect-browser.mjs "$@"
