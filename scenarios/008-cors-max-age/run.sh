#!/usr/bin/env bash
# mode: M2
# 008-cors-max-age — Access-Control-Max-Age の実効期間を測る
#
# 前提: docker compose up -d --wait
#
# ⚠️ 上限（③）は約 2 時間 5 分かかる。CI では回らない。
#    短時間の ①② のみ回す場合は SKIP_CLAMP=1 を付ける。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# nginx にログを開き直させる。コンテナを動かしたままログを置き換えると nginx は
# 削除済み inode へ書き続け、到着記録が届かなくなる（全ケースが偽の「preflight なし」になる）。
docker compose exec -T edge nginx -s reopen

# ① 宣言しないときの既定値
node tools/measure-cors-max-age.mjs --browser=chromium --path=/008/maxage-default/cr --duration=24 --interval=1 --label=default
node tools/measure-cors-max-age.mjs --browser=firefox  --path=/008/maxage-default/ff --duration=24 --interval=1 --label=default
node tools/measure-cors-max-age.mjs --browser=webkit   --path=/008/maxage-default/wk --duration=30 --interval=1 --label=default

# ② 小さい値が厳密に守られるか
node tools/measure-cors-max-age.mjs --browser=chromium --path=/008/maxage-2/cr --duration=14 --interval=1 --label=maxage-2
node tools/measure-cors-max-age.mjs --browser=firefox  --path=/008/maxage-2/ff --duration=14 --interval=1 --label=maxage-2
node tools/measure-cors-max-age.mjs --browser=webkit   --path=/008/maxage-2/wk --duration=30 --interval=1 --label=maxage-2

# ③ ブラウザ側の上限（約 2 時間 5 分）
if [ "${SKIP_CLAMP:-0}" != "1" ]; then
    bash tools/measure-008-clamp.sh
fi

node tools/aggregate-008.mjs max-age
