#!/usr/bin/env bash
# mode: M2
# 010-hsts-ui — ブラウザ UI からの HSTS 削除は効くのか（実 Chrome）
#
# 前提: docker compose up -d --wait / Google Chrome がインストール済み
# 🔴 Playwright 同梱の Chromium では chrome://net-internals に到達できない
#    （page.goto も CDP も net::ERR_INVALID_URL）。実 Chrome が要る。
# 🔴 ユーザーの既定プロファイルは触らない（mkdtemp の一時プロファイル・終了時に削除）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node tools/measure-010-ui.mjs
