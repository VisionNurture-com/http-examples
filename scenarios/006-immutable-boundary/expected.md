# 006-immutable-boundary — 記事に載せる値

> この表の値は `results/006-immutable-boundary/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

> 🔴 **2026-08-10 に http を測定範囲へ追加しました。** それまで本シナリオは https のみで、
> 「Firefox が `immutable` を https でのみ honor する」という記事の記述のうち **http 側に対応する
> 記録がありませんでした**。差が「https だから出た」と言うには、http で差が出ないという対照が要ります。
> 追加した 4 キー（`firefox_http_*` と `schemes_measured`）がその対照です。
> 実測は **http では `immutable` の有無にかかわらず 304**、**https では `immutable` ありのみ到着 0 件**でした。

```json
{
  "scenario": "006-immutable-boundary",
  "mode": "M2",
  "values": {
    "firefox_https_plain_fetch_nocache_hits": 1,
    "firefox_https_immutable_fetch_nocache_hits": 0,
    "chromium_https_immutable_fetch_nocache_hits": 1,
    "webkit_https_immutable_fetch_nocache_hits": 1,
    "firefox_http_plain_fetch_nocache_hits": 1,
    "firefox_http_immutable_fetch_nocache_hits": 1,
    "firefox_http_immutable_fetch_nocache_statuses": [
      304
    ],
    "schemes_measured": [
      "http",
      "https"
    ],
    "stale_second_statuses": [
      304
    ],
    "restart_hits_chromium": 0,
    "restart_hits_webkit": 1
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "immutable5  \"max-age=5, immutable\""
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
