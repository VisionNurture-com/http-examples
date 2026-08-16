#!/usr/bin/env bash
# mode: M2
# 012-dictionary — 圧縮辞書（RFC 9842）は素の nginx で配れるか
#
# 前提: bash tools/gen-certs.sh && docker compose up -d --wait
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# 差分を作り直す（辞書のハッシュが変わったら 012-compression.conf も直す）
node tools/make-012-artifacts.mjs

# 4 エンジンぶん。firefox / webkit は辞書を使わないことの確認
for engine in chrome chromium firefox webkit; do
  node tools/measure-012-dictionary.mjs --engine="$engine"
done

# 証明書ゲートの切り分け（localhost と、手元 CA のホスト名）
node tools/measure-012-dictionary.mjs --engine=chrome --require-known-root --label=chrome-localhost-gate-on
DICT_HOST=dict.example.test DICT_PORT=8443 \
  node tools/measure-012-dictionary.mjs --engine=chrome --require-known-root --label=chrome-privatehost-gate-on
DICT_HOST=dict.example.test DICT_PORT=8443 \
  node tools/measure-012-dictionary.mjs --engine=chrome --label=chrome-privatehost-gate-off

node tools/aggregate-012.mjs dictionary
