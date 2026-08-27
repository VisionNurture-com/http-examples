# 012-breakeven — 記事に載せる値

> この表の値は `results/012-breakeven/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-breakeven",
  "mode": "M0",
  "values": {
    "dictionary_on_wire_bytes": 25582,
    "existing_resource_flow_has_breakeven": false,
    "existing_resource_flow_extra_first_visit_bytes": 0,
    "breakeven_updates_at_smallest_delta": 2,
    "breakeven_updates_at_half_change": 2
  }
}
```

## 読み方

🔴 **「初回コスト vs 再訪利得」は、どちらの流し方を採るかで意味が変わります。**

| 流し方 | 辞書の実体 | 初回の追加コスト | 分岐点 |
|---|---|---:|---|
| **すでに配ってある資源を辞書にする** | 前のデプロイの `bundle-v1.js` | **0 バイト** | **存在しない**。1 回目の更新から得 |
| **専用の辞書ファイルを配る** | 別途配る辞書 | ワイヤ上 **25,582 バイト** | **2 回目の更新**で回収 |

- 2 つを混ぜて 1 つの分岐点を出すと、**存在しないコストを勘定に入れた数字**になります
- 専用辞書型でも、行の半分を書き換える更新なら**やはり 2 回目**で回収します。回収できないのは全行を置き換えたときだけです
- 🔴 実トラフィックでのキャッシュヒット率は仮定していません。ここで出しているのは**バイト数の勘定**だけです
