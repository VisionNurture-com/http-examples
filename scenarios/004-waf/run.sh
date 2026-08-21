#!/usr/bin/env bash
# mode: M1
# 004-waf — WAF の 403 とアプリの 403 をクライアントから見分けられるか
#
# 前提: docker compose up -d --wait（waf サービスを含む）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-004.mjs --scenario=004-waf
