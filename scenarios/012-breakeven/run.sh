#!/usr/bin/env bash
# mode: M0
# 012-breakeven — 圧縮辞書は何回目の更新で元が取れるか
#
# 前提: bash scenarios/012-crossover/run.sh（変更率スイープの結果を使う）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node tools/measure-012-breakeven.mjs
