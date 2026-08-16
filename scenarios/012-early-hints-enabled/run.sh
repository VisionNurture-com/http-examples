#!/usr/bin/env bash
# mode: M2
# 012-early-hints-enabled — nginx に early_hints を書くと 103 は客まで届くのか
#
# 前提: bash tools/gen-certs.sh && docker compose up -d --wait
# 🔴 app を作り直したら edge も再起動すること。nginx は上流の IP を起動時に解決するため、
#    作り直した app へは 502 を返し続ける。
#
# 🔴 012-early-hints（既定の状態で 18 通り）は触らない。本シナリオは別の入口
#    `/012/ehon` を使い、違いを nginx の `early_hints` 1 行だけに保つ。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose restart edge >/dev/null
sleep 2

node tools/measure-012-early-hints-enabled.mjs
