# 004-auth-headed — 記事に載せる値

> この表の値は `results/004-auth-headed/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-auth-headed",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "arms_tested": ["none", "basic", "bearer", "forbidden", "stripped_basic"],
    "not_delivered_to_page": ["chromium:headed_basic"],
    "headless_headed_differs": true,
    "native_dialog_pixels": "未測定（実 Chrome を占有できないため。自動化はプロンプトを自前で打ち切る）",
    "firefox_webkit_dialog": "未測定（プロンプトを出さなかったのか、自動化が抑止したのか本装置では分けられない）"
  }
}
```

## 読み方

**3 エンジン × 2 モード × 5 アームの 30 通りのうち、応答がページへ渡らなかったのは 1 通りだけ**でした。

| 組み合わせ | 結果 |
|---|---|
| Chromium・headed・`Basic` の 401 | ❌ **ページへ渡らない**（`net::ERR_INVALID_AUTH_CREDENTIALS`） |
| 上記以外の 29 通り | ✅ 401 / 403 がそのまま渡る |

- 🔴 **同じ Chromium でも headless では渡ります。**つまり「401 + `Basic` はページに渡らない」という挙動は、**画面を持つブラウザでのみ**起きます
- `Bearer` の 401 は headed でも渡りました。**引き金は 401 そのものではなく challenge のスキーム**です
- プロキシで challenge を剥がしたアームは headed でも渡りました。回避策は効いています
- **測っていない範囲**: ダイアログが画面に出たかどうか / Firefox・WebKit の挙動が「出さない」のか「抑止された」のか
