#!/usr/bin/env bash
# mode: M1
# 008-header-always — add_header が応答から落ちる条件を測る（ブラウザ不要・curl のみ）
#
# 測るもの:
#   ① always の有無 × 応答コード（200 / 500）
#   ② 継承ルール — location に add_header を 1 つ足すと親の値が消えるか
#   ③ add_header_inherit merge;（nginx 1.29.3 で追加）で親の値が戻るか
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# nginx にログを開き直させる。コンテナを動かしたままログを置き換えると nginx は
# 削除済み inode へ書き続け、到着記録が届かなくなる（全ケースが偽の「preflight なし」になる）。
docker compose exec -T edge nginx -s reopen

OUT="results/008-header-always"
mkdir -p "$OUT"
LOG="$OUT/run.log"
BASE="http://localhost:8082"

{
  echo "measured-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "scenario: 008-header-always"
  echo "mode: M1"
  echo "nginx: $(docker compose exec -T edge nginx -v 2>&1 | tr -d '\r')"
  echo "base: $BASE"
  echo "---"
} > "$LOG"

for c in always/ok always/err noalways/ok noalways/err inherit/off inherit/merge; do
  {
    echo "## /008/$c"
    curl -sS -i -H "Origin: http://localhost:8080" "$BASE/008/$c" \
      | grep -iE '^HTTP/|^access-control-|^x-extra' | tr -d '\r'
    echo ""
  } >> "$LOG"
done

node tools/aggregate-008-header-always.mjs
