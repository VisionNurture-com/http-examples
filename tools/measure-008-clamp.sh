#!/usr/bin/env bash
# measure-008-clamp.sh — Access-Control-Max-Age のブラウザ側クランプを測る（M2・約 2 時間）
#
# 何を測るか:
#   サーバは Access-Control-Max-Age: 86400 を宣言する。ブラウザがそれを
#   そのまま使うか、自分の上限で頭打ちにするかを、preflight の再発で観測する。
#
#   Chromium: 上限で頭打ちになるなら、t≈7200 秒で 2 回目の preflight が届く
#   Firefox : 上限がもっと大きいなら、2 時間では 2 回目が届かない
#   WebKit  : 上限を書いた一次情報が存在しないため、この測定が唯一の根拠になる
#
#   3 ブラウザを同時に走らせ、別パス（/cr と /ff と /wk）を使うので記録は混ざらない。
#
# 🔴 WebKit を足す前に予備測定を済ませてある（2026-08-08）。
#    max-age: 60 を宣言して 150 秒観測し、再発間隔は [60, 60] 秒。
#    WebKit は preflight をキャッシュし、宣言値を尊重する。よって本測定に意味がある。
#
# 前提:
#   docker compose up -d --wait  を先に実行しておくこと
#
# 実行:
#   bash tools/measure-008-clamp.sh
#
# 所要時間: 約 2 時間 5 分。途中でブラウザは表示されない（headless）。
# スリープすると測定が壊れるため、実行中はスリープさせないこと（caffeinate 推奨）。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DURATION="${DURATION:-7500}"   # 7500 秒 = 2 時間 5 分（7200 のクランプを越える）
INTERVAL="${INTERVAL:-30}"     # 30 秒ごとに投げる

if ! docker compose ps --status running --quiet edge >/dev/null 2>&1; then
    echo "エラー: compose が起動していません。先に docker compose up -d --wait を実行してください。" >&2
    exit 1
fi

echo "[clamp] 開始 $(date -u +%Y-%m-%dT%H:%M:%SZ) — 約 $((DURATION / 60)) 分かかります"
echo "[clamp] 終了予定 $(date -u -v+${DURATION}S +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '約 2 時間後')"

node tools/measure-cors-max-age.mjs --browser=chromium --path=/008/maxage-86400/cr \
     --duration="$DURATION" --interval="$INTERVAL" --label=clamp &
PID_CR=$!

node tools/measure-cors-max-age.mjs --browser=firefox --path=/008/maxage-86400/ff \
     --duration="$DURATION" --interval="$INTERVAL" --label=clamp &
PID_FF=$!

node tools/measure-cors-max-age.mjs --browser=webkit --path=/008/maxage-86400/wk \
     --duration="$DURATION" --interval="$INTERVAL" --label=clamp &
PID_WK=$!

wait "$PID_CR" "$PID_FF" "$PID_WK"

echo ""
echo "[clamp] 完了 $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[clamp] 結果:"
for f in results/008-cors-max-age/clamp.*.json; do
    node -e '
      const d = require("fs").readFileSync(process.argv[1], "utf8");
      const r = JSON.parse(d);
      console.log(`  ${r.browser} ${r.browser_version}: preflight ${r.preflight_count} 回 / 再発間隔(s) [${r.preflight_gaps_s.join(", ")}]`);
    ' "$f"
done
