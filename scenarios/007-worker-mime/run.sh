#!/usr/bin/env bash
# mode: M2
# 007-worker-mime — classic worker の MIME 検査を型を振って測る
#
# 🔴 実ブラウザを使うため CI では回りません。手元で実行し results/ をコミットします。
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node tools/measure-007-worker-mime.mjs --browser=all
