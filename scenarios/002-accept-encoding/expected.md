# 002-accept-encoding — 記事に載せる値

> この表の値は `results/002-accept-encoding/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "002-accept-encoding",
  "mode": "M1",
  "values": {
    "nginx_default_is_gzip_off": true,
    "bytes_gzip_nginx_static": 886,
    "bytes_plain_nginx_static": 1511,
    "status_unchanged": true,
    "vary_present": false
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/002-minimal.conf",
      "must_contain": ["gzip on;", "gzip_types text/plain application/json;", "gzip_min_length 256;"]
    }
  ]
}
```

## 読み方

| 送り方 | 応答 | `Content-Encoding` | バイト |
|---|:--:|---|---:|
| `Accept-Encoding: gzip` | 200 | `gzip` | **886** |
| 削除 | 200 | なし | **1,511** |

- **応答コードは変わりません。**変わるのは中身です
- 同じ URL で **1.7 倍**の差が出ます。バイト数を見ていなければ「同じ結果」に見えます
- 🔴 **`Vary` が付いていません。**nginx の `gzip_vary` は既定が off のためです。共有キャッシュを前に置くと、圧縮した応答を非対応のクライアントへ配る事故につながります
- この差はこちらが `gzip on` を書いたから出ます。書かなければ `Accept-Encoding` は「削っても変わらない」側でした

🔴 実効値は `nginx 1.31.3`（`nginx:1.31.3-alpine`）で測った 1 点です。圧縮後のバイト数は nginx の版と圧縮水準で動きます。
