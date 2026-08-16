#!/usr/bin/env bash
# mode: M2
# 012-early-hints — 「TTFB が下がった」の見かけと実際を分けて測る
#
# 前提: bash tools/gen-certs.sh && docker compose up -d --wait
# 🔴 app を作り直したら edge も再起動すること。nginx は上流の IP を起動時に解決するため、
#    作り直した app へは 502 を返し続ける（実際にこれで測定を 1 巡やり直した）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose restart edge >/dev/null
sleep 2

rm -f results/012-early-hints/run.log
for engine in chrome firefox webkit; do
  node tools/measure-012-early-hints.mjs --engine="$engine" --repeat=5
done

node tools/aggregate-012.mjs early-hints
