# 006-immutable — 記事に載せる値

> この表の値は `results/006-immutable/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-immutable",
  "mode": "M2",
  "values": {
    "cases_measured": 24,
    "plain_second_hits_max": 0,
    "immutable_second_hits_max": 0,
    "cases_where_immutable_differs": 0,
    "schemes_measured": [
      "http",
      "https"
    ],
    "routes_measured": [
      "nav",
      "reload"
    ]
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "immutable   \"max-age=600, immutable\"",
        "location = /006/asset/app.css"
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
