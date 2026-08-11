# 006-navigation — 記事に載せる値

> この表の値は `results/006-navigation/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-navigation",
  "mode": "M2",
  "values": {
    "plain_reload_hits": 0,
    "must_revalidate_reload_hits": 0,
    "no_cache_reload_statuses": [
      304
    ],
    "bfcache_browser": "Google Chrome 151.0.7922.76 (macOS)",
    "bfcache_restored_no_cache_page": true,
    "bfcache_restored_no_store_page": true,
    "bfcache_page_arrivals_on_back": 0,
    "playwright_can_measure_bfcache": false,
    "bfcache_restored_no_store_page_http": true,
    "bfcache_restored_no_store_page_https": true,
    "bfcache_restored_no_cache_page_http": true,
    "bfcache_restored_no_cache_page_https": true,
    "bfcache_restored_when_cookie_changed": false,
    "bfcache_page_arrivals_on_back_when_cookie_changed": 1
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "mustrev     \"max-age=600, must-revalidate\""
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
