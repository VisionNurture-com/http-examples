#!/usr/bin/env bash
# mode: M1
# 005-multiprocess-idempotency — 冪等キーの排他は 1 プロセスの中でしか効かない
#
# 前提: docker compose up -d --wait（app と app2 の 2 台が立っていること）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-005-multiprocess.mjs
