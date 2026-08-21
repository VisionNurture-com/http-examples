#!/usr/bin/env bash
# mode: M1
# 004-auth-oauth-error — Bearer の 401 / 403 が challenge に載せるもの
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-004.mjs --scenario=004-auth-oauth-error
