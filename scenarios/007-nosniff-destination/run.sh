#!/usr/bin/env bash
# mode: M2
# 007-nosniff-destination — 型を偽ったとき destination ごとに何が止まるかを測る
#
# 🔴 実ブラウザを使うため CI では回りません。手元で実行し results/ をコミットします。
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node tools/capture-007-browser.mjs --browser=all
