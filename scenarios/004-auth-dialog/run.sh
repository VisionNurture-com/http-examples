#!/usr/bin/env bash
# mode: M2
# 004-auth-dialog — 実ブラウザのネイティブ認証ダイアログを撮る（手動・目視判定）
#
# 🔴 実アプリを操作する。実行中はキーボードとマウスに触れないこと。
#    Chrome / Firefox は一時プロファイルの別インスタンス、Safari は新規ウィンドウを使う。
#
# 前提: docker compose up -d --wait / macOS の画面収録・アクセシビリティ許可
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

bash tools/capture-004-dialog.sh
