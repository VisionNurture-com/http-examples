#!/usr/bin/env bash
# mode: M1
# 004-cache-varnish — 別実装のキャッシュ（Varnish）はコードで保存を変えるか
#
# 前提: docker compose up -d --wait（cache サービスを含む）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-004.mjs --scenario=004-cache-varnish
