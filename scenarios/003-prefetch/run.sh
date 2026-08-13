#!/usr/bin/env bash
# mode: M2
# 003-prefetch — 状態を変える GET を先読みが踏むか（実ブラウザ 3 エンジン）
#
# 測るもの: rel="prefetch" の対象に「状態を変える GET」を置き、5 秒待って消費数を読む。
#
# 🔴 踏まなかった場合は「未測定」ではなく「踏まなかった」と記録する。ただし
#    踏まないエンジンについて、記事に「先読みしない」とは書かない（本シナリオが
#    測ったのは 1 つの先読み経路だけで、投機的読み込みの全経路ではない）。
#
# 前提: docker compose up -d --wait / npx playwright install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

docker compose exec -T edge nginx -s reopen

node tools/measure-003-browser.mjs --scenario=003-prefetch
