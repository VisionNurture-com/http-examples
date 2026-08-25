#!/usr/bin/env bash
# mode: M2
# 010-hsts-removal — HSTS の解除は効くのか（Playwright 同梱 3 エンジン）
#
# 前提: docker compose up -d --wait
# 🔴 ブラウザには :80 / :443 に見せる（tools/hsts-proxy.mjs）。
#    RFC 6797 §8.3 の upgrade は明示ポートを保持するため、8094 / 8449 のまま測ると
#    「HSTS が効いた」と「経路が壊れた」を区別できない。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node tools/measure-010-hsts.mjs
