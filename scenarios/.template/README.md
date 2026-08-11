# シナリオのひな形

`scenarios/<id>/` に 3 ファイルを置きます。`<id>` は `NNN-<主題>` 形式（`NNN` は記事番号）。

| ファイル | 役割 |
|---|---|
| `README.md` | 何を測るか / 実効値カードのどの欄を埋めるか |
| `run.sh` | 実行手順。先頭に `# mode: M1` の形式で実行モードを宣言する |
| `expected.md` | **記事に載せる値の正本**。```json の provenance ブロックを持つ |

`expected.md` の provenance ブロック:

```json
{
  "scenario": "008-cors-max-age",
  "mode": "M2",
  "values": { "chromium_max_age_effective": 7200 },
  "config_refs": [
    { "path": "nginx/conf.d/008-cors.conf", "must_contain": "Access-Control-Max-Age" }
  ]
}
```

`values` は `results/<id>/summary.json` と突合されます。食い違えば `npm run check:provenance` が落ちます。
`config_refs.must_contain` は、記事が引用する断片が設定ファイルに実在するかの検査です。
