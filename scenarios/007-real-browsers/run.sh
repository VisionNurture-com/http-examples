#!/usr/bin/env bash
# mode: M2
# 007-real-browsers — Playwright 同梱版ではなく、ホストの実ブラウザで測る
#
# 🔴 Firefox / Safari はユーザーのブラウザでタブを開きます。測定後もタブは残ります。
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
curl -s -X DELETE http://localhost:8080/007/report >/dev/null
node tools/measure-007-real-browsers.mjs --browser=chrome
node tools/measure-007-real-browsers.mjs --browser=firefox
node tools/measure-007-real-browsers.mjs --browser=safari
node tools/measure-007-real-browsers.mjs --aggregate
