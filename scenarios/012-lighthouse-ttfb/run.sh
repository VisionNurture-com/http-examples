#!/usr/bin/env bash
# mode: M1
# 012-lighthouse-ttfb — Lighthouse の「サーバ応答時間」は 103 で何を返すのか
#
# 前提: docker compose up -d --wait
#
# 🔴 アプリへ直結して測る。nginx は既定で上流の 103 を落とすため（012-early-hints）、
#    経路に挟むと「103 あり」の条件そのものが作れない。
#
# 🔴 Lighthouse は npx で取得する。版が変わると値の意味も変わりうるため、
#    summary.json に実行時の版を残している。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-012-lighthouse-ttfb.mjs
