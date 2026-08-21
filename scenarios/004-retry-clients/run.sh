#!/usr/bin/env bash
# mode: M2
# 004-retry-clients — 言語ごとの HTTP クライアントは Retry-After に従うか
#
# 🔴 mode: M2 は「手元でのみ回る」の意味で、ブラウザを使うという意味ではない。
#    python3 / java / go / ruby / bun の 5 ランタイムを要するため CI からは外す。
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-004-clients.mjs
