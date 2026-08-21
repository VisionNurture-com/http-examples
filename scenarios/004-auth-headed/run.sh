#!/usr/bin/env bash
# mode: M2
# 004-auth-headed — headless と headed で 401 の扱いが変わるか（測定装置の差を測る）
#
# ウィンドウが開く。実行中は操作しないこと。
#
# 前提: docker compose up -d --wait / npx playwright install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/capture-004-browser.mjs --scenario=004-auth-headed
