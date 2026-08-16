# 012-timing-api — 記事に載せる値

> この表の値は `results/012-timing-api/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-timing-api",
  "mode": "M0",
  "values": {
    "engines_probed": 4,
    "final_response_headers_start_everywhere": true,
    "first_response_headers_start_nowhere": true
  }
}
```

## 読み方

- 実在する属性は **`finalResponseHeadersStart`**。`firstResponseHeadersStart` は 4 エンジンのいずれにも存在しません。Chrome 自身のリリースノートに書かれている名前を写すと、無い属性を参照することになります
- `firstInterimResponseStart` と `finalResponseHeadersStart` は **Chromium 系だけの話ではありません**。Firefox 153 と WebKit 26.5 にもあります
- 版番号の出典は chromestatus（[115](https://chromestatus.com/feature/5086730938482688) / [133](https://chromestatus.com/feature/5158830722514944)）。どちらも desktop / Android とも同じ版で `Enabled by default`
