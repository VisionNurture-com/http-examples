#!/usr/bin/env bash
# mode: M2
# 010-hsts-gecko — Gecko は HSTS をどこに持ち、どうすれば消えるのか
#
# 前提: docker compose up -d --wait
# 🔴 ブラウザには :80 / :443 に見せる（tools/hsts-proxy.mjs）。
#
# 🔴 UI 削除（ui_delete_entries_after）だけは人手が要る:
#      node tools/measure-010-gecko-ui.mjs          # 登録して Firefox を開いたまま終了
#      （画面で 履歴 → すべての履歴を表示 → example.test を右クリック → このサイトを忘れる）
#      node tools/measure-010-gecko-ui.mjs --read > results/010-hsts-gecko/ui-after.json
#    Firefox の chrome UI は macOS のアクセシビリティ API にほぼ露出せず（実測: AXButton 3 個のみ）、
#    Playwright は Juggler パッチ入りビルドのため実 Firefox を操作できない。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node tools/measure-010-gecko-state.mjs --real
