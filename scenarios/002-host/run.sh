#!/usr/bin/env bash
# mode: M1
# 002-host — Host を削ると誰が弾くか（nginx 単独 / nginx→Express / Express 直結）
#
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-002.mjs --scenario=002-host
