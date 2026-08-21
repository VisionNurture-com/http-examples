# 004-cache-varnish — 記事に載せる値

> この表の値は `results/004-cache-varnish/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-cache-varnish",
  "mode": "M1",
  "values": {
    "codes_tested": [200, 201, 400, 401, 403, 404, 410, 418, 422, 429, 451, 500, 502, 503],
    "varnish_cached_codes": [200, 404, 410],
    "nginx_cached_codes": [200, 201, 400, 401, 403, 404, 410, 418, 422, 429, 451, 500, 502, 503],
    "varnish_429": "MISS",
    "nginx_429": "HIT",
    "varnish_200": "HIT",
    "nginx_200": "HIT"
  },
  "config_refs": [
    {
      "path": "varnish/default.vcl",
      "must_contain": ["set resp.http.X-Cache = \"HIT\";", ".host = \"app\";"]
    },
    {
      "path": "nginx/conf.d/004-status.conf",
      "must_contain": ["location /004/cached-cc/"]
    }
  ]
}
```

## 読み方

**同じ応答に対して、答えが割れました。**

| 前段 | 保存したコード（14 コード中） |
|---|---|
| nginx 1.31.3 | **14 コードすべて**（429 と 503 を含む） |
| Varnish 9.0.3 | **200 / 404 / 410 の 3 つだけ** |

- Varnish は `Cache-Control: max-age=60` がついた 429 でも保存しませんでした。**応答の申告より、コードごとの規定を優先しています**
- 逆に nginx は、コードを見ずに応答の申告どおりに保存しました
- つまり「キャッシュはステータスコードを見るか」に**一般解はありません**。RFC 6585 §4 の `MUST NOT` を守る実装と守らない実装が、どちらも広く使われています
- 🔴 **自分の前段がどちらなのかは、測らないと分かりません**

> **測っていない範囲**: Squid・Apache Traffic Server・各社 CDN。ここで測ったのは nginx 1.31.3 と Varnish 9.0.3 の 2 実装だけです。
