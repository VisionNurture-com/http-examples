#!/usr/bin/env bash
# mode: M1
# 001-layers — 観測手段ごとに、どの層の失敗までを見分けられるか
#
# 層ごとに失敗を人為的に起こし、4 つの観測手段が何を返すかを記録する。
#
# 🔴 K3（TCP 無応答）だけは docker network の内側から測る。
#    ホストの公開ポート経由では Docker Desktop が握手をホスト側で完了させてしまい、
#    「TCP は成立するが応答が来ない」（= K7）に化ける。
#
# 前提: bash tools/gen-certs.sh && docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

node tools/measure-001.mjs
