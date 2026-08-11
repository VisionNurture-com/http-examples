#!/usr/bin/env bash
# probe-008-preflight-auth.sh — 3 ゾーンの素の応答を curl で取る（M1・ブラウザ不要）
#
# ブラウザ側のハーネスは必ず Authorization を付けて送るため、
# 「認証なしで通ってしまうか」はブラウザからは観測できない。ここを curl で埋める。
#
# 前提: docker compose up -d --wait
#       環境変数 AUTHZONE_CRED を 'user:pass' で設定しておくこと（下記）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/results/008-preflight-auth"
mkdir -p "$OUT"

API="http://localhost:8081"
ORIGIN="http://localhost:8080"
# 測定専用の合成アカウント。nginx/conf.d/008-authzone.htpasswd と対になる。
# htpasswd は git 管理から外してあるため（資格情報を履歴に残さない）、値はここに書かず
# 環境変数から取る。作り方は scenarios/008-preflight-auth/README.md を参照。
CRED="${AUTHZONE_CRED:?AUTHZONE_CRED が未設定です。'user:pass' の形で指定してください（scenarios/008-preflight-auth/README.md 参照）}"

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

{
  echo "{"
  echo "  \"probe\": \"curl\","
  first=1
  for z in guarded exempt shortcut; do
    o=$(code -X OPTIONS "$API/008/authzone/$z/curl" -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: GET')
    g1=$(code "$API/008/authzone/$z/curl" -H "Origin: $ORIGIN")
    g2=$(code -u "$CRED" "$API/008/authzone/$z/curl" -H "Origin: $ORIGIN")
    [ $first -eq 0 ] && echo ","
    first=0
    printf '  "%s_options_noauth": %s,\n' "$z" "$o"
    printf '  "%s_get_noauth": %s,\n' "$z" "$g1"
    printf '  "%s_get_auth": %s' "$z" "$g2"
  done
  echo ""
  echo "}"
} > "$OUT/curl-probe.json"

cat "$OUT/curl-probe.json"
