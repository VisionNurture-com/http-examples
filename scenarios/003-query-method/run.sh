#!/usr/bin/env bash
# mode: M1
# 003-query-method — QUERY（RFC 10008）を 3 回送ってサーバ状態がどう動くか（ブラウザ不要・curl のみ）
#
# 測るもの:
#   ① 読むだけの実装に QUERY を 3 回 → 状態は 1 通りか
#   ② 読むだけのつもりで数を進める実装に QUERY を 3 回 → 状態は何通りか
#   ③ メソッド名を小文字で書いたときに何が返るか（GET を対照に置く）
#
# 🔴 判定はサーバ状態（GET /003/state）で行う。応答が同じかどうかでは冪等性を判定しない。
# 🔴 仕様（RFC 10008 §2）は QUERY を safe かつ idempotent と定めるが、それは名前の意味であって
#    ハンドラの保証ではない。記事 003 の主題をそのまま新しいメソッドへ当てる。
#
# 前提: docker compose up -d --wait
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# 動かしたままログを置き換えると nginx は削除済み inode へ書き続ける。開き直させる。
docker compose exec -T edge nginx -s reopen

node tools/measure-003.mjs --scenario=003-query-method
