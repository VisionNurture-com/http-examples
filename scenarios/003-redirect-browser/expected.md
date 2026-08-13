# 003-redirect-browser — 記事に載せる値

> この表の値は `results/003-redirect-browser/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "003-redirect-browser",
  "mode": "M2",
  "values": {
    "method_at_destination": {
      "chromium": { "301": "GET", "302": "GET", "303": "GET", "307": "POST", "308": "POST" },
      "firefox": { "301": "GET", "302": "GET", "303": "GET", "307": "POST", "308": "POST" },
      "webkit": { "301": "GET", "302": "GET", "303": "GET", "307": "POST", "308": "POST" }
    },
    "body_bytes_at_destination": {
      "chromium": { "301": 0, "302": 0, "303": 0, "307": 11, "308": 11 },
      "firefox": { "301": 0, "302": 0, "303": 0, "307": 11, "308": 11 },
      "webkit": { "301": 0, "302": 0, "303": 0, "307": 11, "308": 11 }
    },
    "arrivals_recorded": { "chromium": 5, "firefox": 5, "webkit": 5 }
  },
  "browsers": ["chromium", "firefox", "webkit"],
  "config_refs": [
    {
      "path": "nginx/conf.d/003-methods.conf",
      "must_contain": [
        "location = /003/redirect/303 { return 303 /003/sink/303$is_args$args; }",
        "location = /003/redirect/308 { return 308 /003/sink/308$is_args$args; }"
      ]
    }
  ]
}
```

## 読み方

同一オリジンの `fetch` で 11 バイトの本文を付けた POST を送り、転送先に届いたものを記録しています。Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5 で**結果はすべて一致**しました。

| ステータス | 届いたメソッド | 届いた本文 |
|---|---|:--:|
| 301 / 302 / 303 | **GET** | 0 バイト |
| 307 / 308 | POST | 11 バイト |

curl の既定（`003-redirect-method` の `implicit`）と同じ結果です。**書き方で結果が変わったのは curl 側だけ**で、ブラウザの `fetch` にはメソッドを保つ指定がありません。
