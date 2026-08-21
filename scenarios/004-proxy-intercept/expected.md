# 004-proxy-intercept — 記事に載せる値

> この表の値は `results/004-proxy-intercept/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-proxy-intercept",
  "mode": "M1",
  "values": {
    "status_direct": 403,
    "content_type_direct": "application/problem+json; charset=utf-8",
    "detail_kept_direct": true,
    "status_intercepted": 403,
    "content_type_intercepted": "text/html",
    "detail_kept_intercepted": false,
    "body_replaced_marker": true,
    "mismatch_actual_status": 403,
    "mismatch_body_status": 500
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/004-status.conf",
      "must_contain": ["proxy_intercept_errors on;", "error_page 401 403 404 429 503 /004/err.html;"]
    }
  ]
}
```

## 読み方

**コードは残り、本文だけが消えました。**

| 経路 | コード | Content-Type | 詳細が残ったか |
|---|:--:|---|:--:|
| 素の転送 | 403 | `application/problem+json` | ✅ 残る |
| `proxy_intercept_errors on;` | 403 | `text/html` | ❌ **消える** |

- 差し替え後の本文はプロキシ側のページに置き換わっていました（目印 `PROXY-ERROR-PAGE` を確認）
- **403 という結果だけが読者側に届き、「残高が 30 で 50 必要」という理由は届きません。**設定 1 行で起きます
- `status` メンバを実際のコードと食い違わせたアームでは、**HTTP のコードは 403・本文の `status` は 500** のまま両方が届きました。RFC 9457 §3.1.2 は一致を MUST とし、汎用ソフトが見るのは HTTP のコードだと明記しています
