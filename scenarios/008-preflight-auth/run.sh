#!/usr/bin/env bash
# mode: M2
# 008-preflight-auth — Basic 認証をかけた領域への preflight を 3 エンジン + curl で測る
#
# 前提: docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# nginx にログを開き直させる。コンテナを動かしたままログを置き換えると nginx は
# 削除済み inode へ書き続け、到着記録が届かなくなる（全ケースが偽の「preflight なし」になる）。
docker compose exec -T edge nginx -s reopen

mkdir -p results/008-preflight-auth
rm -f results/008-preflight-auth/run.log

node tools/measure-008-preflight-auth.mjs --browser=chromium
node tools/measure-008-preflight-auth.mjs --browser=firefox
node tools/measure-008-preflight-auth.mjs --browser=webkit

# 認証なしで通ってしまうかはブラウザから観測できない（必ず Authorization が付くため）
bash tools/probe-008-preflight-auth.sh

node tools/aggregate-008-extra.mjs preflight-auth
