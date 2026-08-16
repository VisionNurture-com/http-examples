# 012-crossover — 記事に載せる値

> この表の値は `results/012-crossover/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-crossover",
  "mode": "M0",
  "values": {
    "dictionary_bytes": 99465,
    "dictionary_lines": 2372,
    "crossover_ratio_dcb_over_br": 1,
    "crossover_ratio_dcz_over_zstd": 1,
    "dcb_still_smaller_at_full_change": false
  }
}
```

## 読み方

- **辞書は「ほぼ同じファイル」専用の道具ではありません**。行の半分を書き換えても `dcb` は `br` の 39%（8,976 対 22,844）です
- 追い抜かれるのは**全行を置き換えたとき**で、そこでようやく `dcb` が `br` をわずかに上回ります（17,362 対 17,326 = 1.002 倍）
- つまり「更新のたびに中身が総入れ替えになる資源」以外では、辞書ありが負ける条件を作るほうが難しいという結果です
- 🔴 変更率は**行単位の置換**という模型で作った目盛りです。実際のデプロイの差分と同じではありません
