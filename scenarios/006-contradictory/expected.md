# 006-contradictory — 記事に載せる値

> この表の値は `results/006-contradictory/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-contradictory",
  "mode": "M2",
  "values": {
    "no_store_with_max_age_statuses": [
      200
    ],
    "no_cache_with_max_age_statuses": [
      304
    ],
    "no_store_with_no_cache_statuses": [
      200
    ],
    "mdn_conflicted_example_statuses": [
      200
    ],
    "must_revalidate_fresh_hits": 0,
    "engines_agree": true
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "conflicted  \"private, no-cache, no-store, max-age=0, must-revalidate\""
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
