# 004-browser-render — 記事に載せる値

> この表の値は `results/004-browser-render/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-browser-render",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "codes_tested": [200, 403, 404, 410, 429, 500, 503],
    "codes_body_rendered_all_engines": [200, 403, 404, 410, 429, 500, 503],
    "codes_script_ran_all_engines": [200, 403, 404, 410, 429, 500, 503],
    "engines_agree": true
  }
}
```

## 読み方

**7 コードすべてで、3 エンジンとも本文を描画し、スクリプトも実行しました。**

| コード | 本文の描画 | スクリプトの実行 |
|:--:|:--:|:--:|
| 200 / 403 / 404 / 410 / 429 / 500 / 503 | すべて ✅ | すべて ✅ |

- 測ったのは Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5 です
- **ブラウザは 500 を返しても 200 と同じようにページを組み立てます。**コードを正しく選んでも、画面の見た目はこちらが本文で作らないかぎり変わりません
- 逆にいえば、**コードは画面のためではなく、ブラウザの後ろにいる機械のためにあります**
