# 006-staleness — 記事に載せる値

> この表の値は `results/006-staleness/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-staleness",
  "mode": "M2",
  "values": {
    "hits_after_server_fix": 0,
    "rev_seen_after_server_fix": [
      "1"
    ],
    "rev_seen_after_cache_busting": [
      "2"
    ],
    "stale_reproduced_all_engines": true,
    "busting_worked_all_engines": true
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "location ^~ /006/gen/"
      ]
    }
  ],
  "browsers": [
    "chromium",
    "firefox",
    "webkit"
  ]
}
```
