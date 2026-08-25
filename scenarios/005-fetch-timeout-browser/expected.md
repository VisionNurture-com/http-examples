# 005-fetch-timeout-browser の期待値

記事に載せる値の正本。`results/005-fetch-timeout-browser/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| Chromium | 151.0.7922.34（Playwright 同梱）|
| Firefox | 153.0（Playwright 同梱）|
| WebKit | 26.5（Playwright 同梱）|
| 上限 | 330 秒 |
| 測定日 | 2026-08-25 |
| 足場 | `GET /005/never-responds`（接続は成立・応答は返さない）|

## 実測結果

| エンジン | 経過 | 結果 |
|---|---:|---|
| Chromium 151.0.7922.34 | 330 秒 | **上限まで切れなかった** |
| Firefox 153.0 | 330 秒 | **上限まで切れなかった** |
| WebKit 26.5 | 330 秒 | **上限まで切れなかった** |

**3 エンジンのうち、既定で切れたのは 0 件**でした。

## 読み取り

**ブラウザの `fetch` は、応答が返らないまま 330 秒待っても切れません。**3 エンジンとも同じでした。

同じ足場を Node から叩くと **約 300 秒で切れます**（`005-fetch-timeout`）。**同じ `fetch` という名前でも、どこで動かすかで既定が違います。**Node 側には undici のヘッダ待ちタイムアウトがあり、ブラウザ側には対応する既定がありません。

つまり**ブラウザで動くコードに `AbortController` を付けなければ、待ちは終わりません**。「そのうちタイムアウトするだろう」は、少なくともこの 3 エンジンでは成り立ちませんでした。

🔴 **上限まで切れなかった値は「330 秒で切れる」ではありません。**330 秒より長い既定値があるのか、そもそも既定値が無いのかは、この測定では区別できていません。

```json
{
  "scenario": "005-fetch-timeout-browser",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "chromium_elapsed_s": 330,
    "chromium_outcome": "上限まで切れなかった",
    "firefox_elapsed_s": 330,
    "firefox_outcome": "上限まで切れなかった",
    "webkit_elapsed_s": 330,
    "webkit_outcome": "上限まで切れなかった",
    "timed_out_engines": [],
    "timed_out_count": 0,
    "engines_total": 3,
    "cap_ms": 330000
  }
}
```
