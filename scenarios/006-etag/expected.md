# 006-etag — 記事に載せる値

> この表の値は `results/006-etag/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-etag",
  "mode": "M1",
  "values": {
    "etag_on_second_status": 304,
    "etag_off_second_status": 200,
    "etag_off_has_validator": false,
    "cache_control_both": [
      "no-cache"
    ]
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "location = /006/etag/off.css",
        "etag off;"
      ]
    }
  ]
}
```
