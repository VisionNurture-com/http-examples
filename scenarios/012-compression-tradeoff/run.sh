#!/usr/bin/env bash
# mode: M0
# 012-compression-tradeoff — 圧縮の水準 / 小さい応答の境界 / 種別差
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node tools/measure-012-compression-tradeoff.mjs
