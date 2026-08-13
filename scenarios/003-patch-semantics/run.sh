#!/usr/bin/env bash
# mode: M1
# 003-patch-semantics — PATCH の再送が形式と操作でどう変わるか（ブラウザ不要・curl のみ）
#
# 測るもの:
#   ① JSON Merge Patch（RFC 7386）の設定と削除
#   ② JSON Patch（RFC 6902）の replace と、配列末尾への add
#   いずれも同じ本文を 3 回送り、サーバ状態が何通りになるかを数える
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose exec -T edge nginx -s reopen

node tools/measure-003.mjs --scenario=003-patch-semantics
