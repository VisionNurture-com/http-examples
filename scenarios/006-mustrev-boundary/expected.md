# 006-mustrev-boundary — 記事に載せる値

> この表の値は `results/006-mustrev-boundary/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "006-mustrev-boundary",
  "mode": "M2",
  "values": {
    "cases_measured": 6,
    "plain5_stale_statuses": [
      304
    ],
    "must_revalidate_stale_statuses": [
      304
    ],
    "plain5_stale_hits": [
      1
    ],
    "must_revalidate_stale_hits": [
      1
    ],
    "must_revalidate_changes_stale_behaviour": false,
    "engines_agree": true
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/006-cache.conf",
      "must_contain": [
        "mustrev5    \"max-age=5, must-revalidate\"",
        "plain5      \"max-age=5\""
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

## 読み方

`max-age=5` と `max-age=5, must-revalidate` は、**期限が切れたあとの 2 回目がどちらも 304 で一致**しました。3 エンジンとも同じです。到着件数も 1 件ずつで、`must_revalidate_changes_stale_behaviour` は `false` になっています。

`006-contradictory` で測った期限内は到着 0 件でしたから、**期限内も期限切れ後も、オリジンが正常に応答するかぎり `must-revalidate` は結果を変えませんでした**。

## この値で言えないこと

RFC 9111 §5.2.2.2 が `must-revalidate` で禁じているのは、**再検証に失敗したときに古いものを出すこと**です。本シナリオはオリジンが 200 / 304 を返す経路しか通していないため、その場面は測っていません。上の `false` は「オリジンが生きているあいだは差がない」という意味に留まります。
