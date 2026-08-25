#!/bin/sh
# 009 — Apache の CGI へ Authorization が渡るかを見るだけの終端。
#
# 🔴 資格情報の値は出さない。あるか / ないかと、スキーム名だけを返す。
#
# CGIPassAuth の既定は Off で、Apache は Authorization を CGI から隠す。
# 同じスクリプトを Off の URL 空間と On の URL 空間の両方に置き、差だけを読む。
set -eu

printf 'Content-Type: application/json\r\n'
printf '\r\n'

if [ -n "${HTTP_AUTHORIZATION:-}" ]; then
    scheme=$(printf '%s' "$HTTP_AUTHORIZATION" | cut -d' ' -f1)
    printf '{"auth":"yes","scheme":"%s","via":"apache-cgi"}\n' "$scheme"
else
    printf '{"auth":"no","scheme":null,"via":"apache-cgi"}\n'
fi
