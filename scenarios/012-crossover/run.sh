#!/usr/bin/env bash
# mode: M0
# 012-crossover — 辞書はどこまで効くか（変更率を振る）
#
# 前提: brotli / zstd の CLI（辞書付きの圧縮は node:zlib では作れない）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-012-crossover.mjs
