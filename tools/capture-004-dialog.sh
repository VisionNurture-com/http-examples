#!/usr/bin/env bash
# capture-004-dialog.sh — 実ブラウザのネイティブ認証ダイアログを撮る（手動・CI では回らない）
#
# 🔴 自動化ブラウザでは測れないため実アプリで撮る。
#    Playwright は資格情報のプロンプトを自前で打ち切るので、出たかどうかを分けられない。
#
# 前提:
#   - docker compose up -d --wait
#   - macOS の「画面収録」と「アクセシビリティ」を osascript / ターミナルへ許可済み
#   - Chrome / Firefox は一時プロファイルの別インスタンスで起動する（既存セッションに触れない）
#   - Safari は一時プロファイルを持てないため、新規ウィンドウを開いて最後に閉じる
#
# 出力: results/004-auth-dialog/<engine>-<arm>.png
#
# 判定は目視。画面にサインインを求める入力欄が出たかどうかを読む。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/results/004-auth-dialog"
TMP="${TMPDIR:-/tmp}/004-dialog"
EDGE="http://localhost:8088"
RECT="80,80,1000,700"

mkdir -p "$OUT" "$TMP"

shot() { sleep 6; screencapture -x -R "$RECT" "$OUT/$1.png"; echo "  -> $OUT/$1.png"; }

chrome_arm() {
  local name="$1" url="$2"
  pkill -f "user-data-dir=$TMP/chrome" 2>/dev/null || true
  sleep 2
  open -na "Google Chrome" --args --user-data-dir="$TMP/chrome" --no-first-run \
    --no-default-browser-check --window-size=1000,700 --window-position=80,80 "$url"
  shot "chrome-$name"
}

firefox_arm() {
  local name="$1" url="$2"
  pkill -f "$TMP/firefox" 2>/dev/null || true
  sleep 3
  open -na Firefox --args -profile "$TMP/firefox" -no-remote -new-window "$url"
  sleep 9
  osascript -e 'tell application "System Events" to tell process "firefox"
    set frontmost to true
    set position of window 1 to {80, 80}
    set size of window 1 to {1000, 700}
  end tell'
  shot "firefox-$name"
}

echo "== Chrome =="
chrome_arm basic    "$EDGE/004/api/auth/basic?cs=dialog&cl=realchrome-basic"
chrome_arm bearer   "$EDGE/004/api/auth/bearer?cs=dialog&cl=realchrome-bearer"
chrome_arm stripped "$EDGE/004/stripped/auth/basic?cs=dialog&cl=realchrome-stripped"
pkill -f "user-data-dir=$TMP/chrome" 2>/dev/null || true

echo "== Firefox =="
firefox_arm basic  "$EDGE/004/api/auth/basic?cs=dialog&cl=realfirefox-basic"
firefox_arm bearer "$EDGE/004/api/auth/bearer?cs=dialog&cl=realfirefox-bearer"
pkill -f "$TMP/firefox" 2>/dev/null || true

echo "== Safari（既存セッションを使うため最後に窓を閉じる）=="
osascript -e "tell application \"Safari\"
  activate
  make new document with properties {URL:\"$EDGE/004/api/auth/basic?cs=dialog&cl=realsafari-basic\"}
  delay 1
  set bounds of front window to {80, 80, 1080, 780}
end tell"
shot "safari-basic"
osascript -e 'tell application "System Events" to key code 53'   # Esc でダイアログを閉じる
sleep 2
osascript -e "tell application \"Safari\" to set URL of front document to \"$EDGE/004/api/auth/bearer?cs=dialog&cl=realsafari-bearer\""
shot "safari-bearer"
osascript -e 'tell application "Safari" to close front window'

echo "撮影完了。results/004-auth-dialog/ の画像を目視で判定すること。"
