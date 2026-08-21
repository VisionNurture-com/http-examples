#!/usr/bin/env bash
# mode: M1
# 004-auth-challenge — 401 を返した先で何が変わるか（challenge の有無とスキーム）
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-004.mjs --scenario=004-auth-challenge
