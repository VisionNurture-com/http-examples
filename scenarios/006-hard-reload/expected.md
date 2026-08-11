# 006-hard-reload — 記事に載せる値

> この表の値は `results/006-hard-reload/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-hard-reload",
  "mode": "M2",
  "values": {
    "normal_reload_asset_hits_max": 0,
    "hard_reload_statuses": [
      200
    ],
    "hard_reload_asset_hits_min": 1,
    "immutable_changes_hard_reload": false,
    "key_delivered_all_cases": true
  },
  "browsers": [
    "chromium",
    "firefox"
  ],
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "location = /006/asset/app.css"
      ]
    }
  ]
}
```
