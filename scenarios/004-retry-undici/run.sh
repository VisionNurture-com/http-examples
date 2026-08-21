#!/usr/bin/env bash
# mode: M1
# 004-retry-undici — Retry-After に従うかを、版が固定できる 2 経路だけで見張る
#
# 🔴 004-retry-after のうち CI に載せられる分。curl はホストのツールで版が
#    環境ごとに違い、GitHub Actions の runner では再送しなかった（2026-08-20）。
#    Node と undici は package-lock.json が版を固定するため、ここは CI で回す。
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# 実行環境の curl の版を記録に残す（CI と手元で挙動が割れた項目のため）
curl --version | head -1

node tools/measure-004.mjs --scenario=004-retry-undici
