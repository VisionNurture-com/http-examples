#!/usr/bin/env bash
# mode: M2
# 009-redirect-clients — 言語ごとの HTTP クライアントは Authorization を落とすか
#
# 🔴 CI では回りません（6 つのランタイムを要します）。
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-009-clients.mjs
