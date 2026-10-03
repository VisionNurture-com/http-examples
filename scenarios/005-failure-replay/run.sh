#!/usr/bin/env bash
# mode: M1
# 005-failure-replay — 失敗した結果を保存するかで送り直しの結果が変わる
#
# 前提: docker compose up -d --wait（app / app2 / idem-pg / idem-redis が立っていること）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-005-failure-replay.mjs
