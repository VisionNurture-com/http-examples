# 006-expires-conflict — 記事に載せる値

> この表の値は `results/006-expires-conflict/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-expires-conflict",
  "mode": "M2",
  "values": {
    "both_cache_control": [
      "max-age=3600",
      "no-store"
    ],
    "both_cache_control_count": 2,
    "write_order_changes_headers": false,
    "nested_child_own_cache_control_count": 0,
    "nested_child_none_cache_control_count": 2,
    "browser_refetch_when_two_headers": true,
    "browser_caches_when_parent_header_dropped": true
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "location = /006/exp/both.css",
        "location = /006/exp/nest/child-own.css"
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
