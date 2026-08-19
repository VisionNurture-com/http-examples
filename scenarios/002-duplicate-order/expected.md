# 002-duplicate-order — 記事に載せる値

> この表の値は `results/002-duplicate-order/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "002-duplicate-order",
  "mode": "M1",
  "values": {
    "order_changes_status": false,
    "order_preserved_on_wire": true,
    "duplicate_joined_value": "one, two",
    "duplicate_x_sample_status": 200,
    "duplicate_host_status": 400,
    "status_order_base": 200,
    "status_order_swapped": 200
  },
  "config_refs": [
    {
      "path": "app/002-minimal/routes.mjs",
      "must_contain": ["rawHeaderOrder: req.rawHeaders.filter"]
    }
  ]
}
```

## 読み方

| ケース | 結果 |
|---|---|
| 並びを入れ替える | 200 のまま。**並び自体は保存される**が結果は変わらない |
| `X-Sample` を 2 本 | 200。サーバが見た値は **`one, two`**（コンマで連結） |
| **`Host` を 2 本** | **400** |

- 並び替えは結果を変えませんでした。ただしサーバに届く順序は入れ替えたとおりで、**保存はされています**
- 同名の重複は、拒否ではなく**連結**になります。値がコンマ区切りで 1 本にまとまるため、受け取る側が「1 つの値」として扱うと意図しない文字列になります
- `Host` だけは別で、**2 本あると 400** です。RFC 9112 §3.2 が複数の `Host` を拒否するよう定めているとおりでした

🔴 `Host` の重複は curl では組めません（1 本に畳まれます）。この行だけは生ソケットで組んだ結果です。
