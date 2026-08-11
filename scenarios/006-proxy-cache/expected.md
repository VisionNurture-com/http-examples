# 006-proxy-cache — 記事に載せる値

> この表の値は `results/006-proxy-cache/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-proxy-cache",
  "mode": "M1",
  "values": {
    "public_stored": true,
    "private_stored": false,
    "no_store_stored": false,
    "no_directive_stored": true,
    "private_upstream_hits": 2,
    "public_second_cache_status": [
      "HIT"
    ]
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "proxy_cache c006;",
        "proxy_cache_path /var/cache/nginx/006"
      ]
    }
  ]
}
```
