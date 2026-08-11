# 006-expires-directive — 記事に載せる値

> この表の値は `results/006-expires-directive/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-expires-directive",
  "mode": "M1",
  "values": {
    "expires_1h_cache_control": [
      "max-age=3600"
    ],
    "expires_max_cache_control": [
      "max-age=315360000"
    ],
    "expires_max_expires": [
      "Thu, 31 Dec 2037 23:55:55 GMT"
    ],
    "expires_minus1_cache_control": [
      "no-cache"
    ],
    "expires_epoch_expires": [
      "Thu, 01 Jan 1970 00:00:01 GMT"
    ],
    "expires_off_cache_control_count": 0,
    "expires_error500_status": 500,
    "expires_error500_cache_control_count": 0,
    "expires_error500_expires_count": 0
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "expires max;",
        "expires epoch;",
        "expires off;",
        "return 500;"
      ]
    }
  ]
}
```
