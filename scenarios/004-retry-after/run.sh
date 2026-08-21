#!/usr/bin/env bash
# mode: M2
# 004-retry-after — 429 に付けた Retry-After に、実際に従うのは誰か
#
# 🔴 mode: M2 は「手元でのみ回る」の意味。ブラウザは使わない。
#    curl はリポジトリが版を固定できないホストのツールで、実際 GitHub Actions の
#    runner に入っている curl では再送しなかった（2026-08-20 の CI で検出）。
#    固定できない値を CI の突合に載せると、陳腐化ではなく環境差の検知になる。
#    CI へ載せる分は 004-retry-undici（M1）が担う。
#
# 判定はサーバ側の到着間隔で行う（クライアントの自己申告は使わない）。
# 実行に約 15 秒かかる（待ち時間そのものが測定対象のため）。
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-004.mjs --scenario=004-retry-after
