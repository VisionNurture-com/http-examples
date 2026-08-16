#!/usr/bin/env bash
# mode: M1
# 012-vary — Vary を落とすと共有キャッシュが何を配るか
#
# 前提: docker compose up -d --wait
#
# 🔴 差分ファイル（.dcb / .dcz）は生成物で .gitignore 済み。clean clone には無いため
#    ここで必ず作り直す。作らないと nginx が存在しないファイルを指して 404 になり、
#    「Vary を落としても壊れなかった」という逆の結論が出る。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/make-012-artifacts.mjs
# 🔴 試行ごとにキャッシュキーを変える。前の試行の状態を持ち込まない
VARY_RUN_ID="run-$(git rev-parse --short HEAD)-$$" node tools/measure-012-vary.mjs
