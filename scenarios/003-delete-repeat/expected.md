# 003-delete-repeat — 記事に載せる値

> この表の値は `results/003-delete-repeat/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "003-delete-repeat",
  "mode": "M1",
  "values": {
    "sends_per_variant": 2,
    "variants_measured": 3,
    "status_sequence": {
      "strict": [204, 404],
      "lenient": [204, 204],
      "echo": [200, 200]
    },
    "state_same_after_repeat": {
      "strict": true,
      "lenient": true,
      "echo": true
    },
    "response_same_after_repeat": {
      "strict": false,
      "lenient": true,
      "echo": false
    }
  },
  "config_refs": [
    {
      "path": "app/003-methods/routes.mjs",
      "must_contain": [
        "app.delete(\"/003/delete/strict/:id\"",
        "app.delete(\"/003/delete/lenient/:id\"",
        "app.delete(\"/003/delete/echo/:id\""
      ]
    }
  ]
}
```

## 読み方

同じ DELETE を 2 回送り、**状態が同じか**と**応答が同じか**を別々に記録しています。

| 実装 | 1 回目 → 2 回目 | 状態は同じか | 応答は同じか |
|---|---|:--:|:--:|
| 存在を確かめてから消す | 204 → 404 | 同じ | 違う |
| 確かめずに消す | 204 → 204 | 同じ | 同じ |
| 結果を本文で返す | 200 → 200 | 同じ | 違う（本文が `deleted: true` → `false`）|

3 つとも**状態は同じ**です。違うのは応答のほうで、しかも 200 が並ぶ「結果を本文で返す」実装でも本文が変わっています。ステータスだけを見ると同じに見えるため、`response_same_after_repeat` はステータスと本文の両方で判定しています。
