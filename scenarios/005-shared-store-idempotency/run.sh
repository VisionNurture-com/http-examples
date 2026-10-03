#!/usr/bin/env bash
# mode: M1
# 005-shared-store-idempotency — 処理中のキーを共有ストアに置くと 2 台でも 1 回になる
#
# 前提: docker compose up -d --wait（app / app2 / idem-pg / idem-redis が立っていること）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-005-shared-store.mjs
