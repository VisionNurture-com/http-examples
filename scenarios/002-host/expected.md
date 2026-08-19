# 002-host — 記事に載せる値

> この表の値は `results/002-host/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "002-host",
  "mode": "M1",
  "values": {
    "status_without_host_nginx_static": 400,
    "status_without_host_via_nginx": 400,
    "status_without_host_app_direct": 400,
    "curl_refused_to_send": false
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/002-minimal.conf",
      "must_contain": ["location /002/static/", "location /002/api/"]
    }
  ]
}
```

## 読み方

`Host` を落とすと、**3 経路とも 400** が返りました。

| 経路 | Host なしの応答 |
|---|:--:|
| nginx 単独（静的） | 400 |
| nginx→Express | 400 |
| Express 直結（nginx なし） | 400 |

- **curl は送信を拒みません**（`curl_refused_to_send` は `false`）。つまり 400 はサーバの判断であって、手元のツールが止めたものではありません
- nginx を外しても 400 です。Node の HTTP パーサが同じ要件を実装しているため、**プロキシを外せば通るという逃げ道はありません**
- 削って測った 12 本のうち、応答コードが変わったのは `Host` だけでした（[`002-minimize`](../002-minimize/README.md)）
