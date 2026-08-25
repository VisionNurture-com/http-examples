#!/usr/bin/env bash
# mode: M2
# 009-real-browsers — ホストの実ブラウザで測る（Playwright 同梱版の対照）
#
# 🔴 Firefox / Safari はユーザーのブラウザでタブを開きます。
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

curl --silent --show-error --max-time 10 -X POST http://localhost:8080/009/report/__reset
node tools/measure-009-real-browsers.mjs --browser=chrome
node tools/measure-009-real-browsers.mjs --browser=firefox
node tools/measure-009-real-browsers.mjs --browser=safari
node tools/measure-009-real-browsers.mjs --aggregate
