#!/usr/bin/env bash
# mode: M2
# 005-fetch-timeout — 応答が返らないとき、クライアントは何秒待つか
#
# 前提: docker compose up -d --wait
# 🔴 上限 330 秒まで待つため、1 回の実行に 5 分半かかる。
# 🔴 M2（CI 対象外）である。理由は 2 つ:
#    ① 経過秒は環境ごとに揺れ、CI の突合に載せられない
#       （contexts の判定の規約 3「版を固定できない値を CI の突合に載せない」）
#    ② 待つことが測定の本体のため、scenarios ジョブを 5.5 分押し上げる
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-005-timeout.mjs
