# 004-proxy-cache — 記事に載せる値

> この表の値は `results/004-proxy-cache/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-proxy-cache",
  "mode": "M1",
  "values": {
    "cache_second_200": "HIT",
    "cache_second_404": "HIT",
    "cache_second_429": "HIT",
    "cache_second_503": "HIT",
    "codes_cached": [200, 404, 429, 503],
    "cc_header_429": "max-age=60",
    "cc_cache_second_429": "HIT",
    "cc_cache_second_200": "HIT"
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/004-status.conf",
      "must_contain": ["proxy_cache_valid any 60s;", "proxy_cache_key \"cc:$request_uri\";"]
    }
  ]
}
```

## 読み方

**429 も保存されました。**RFC 6585 §4 が `MUST NOT be stored by a cache` と定めているコードです。

| コード | `proxy_cache_valid any` | 応答が `Cache-Control: max-age=60` と申告 |
|:--:|:--:|:--:|
| 200 | HIT | HIT |
| 404 | HIT | — |
| **429** | **HIT** | **HIT** |
| 503 | HIT | — |

- 設定で命じたときだけでなく、**応答側が「保存してよい」と申告しただけでも保存されました**。つまり nginx は「429 だから保存しない」という判断を持っていません
- レート制限の応答が保存されると、制限が解けた後も同じ 429 が返り続けます。**429 を返す口には、コードとは別に `Cache-Control` を自分で付ける必要があります**
