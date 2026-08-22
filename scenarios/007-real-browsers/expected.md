# 007-real-browsers — 記事に載せる値

> この表の値は `results/007-real-browsers/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "007-real-browsers",
  "mode": "M2",
  "values": {
    "non_js_loaded_chrome": 5,
    "non_js_loaded_firefox": 0,
    "non_js_loaded_safari": 0,
    "non_js_types_total": 6,
    "D1_executed_chrome": true,
    "D2_executed_chrome": false,
    "D5_executed_chrome": false,
    "D7_executed_chrome": false,
    "D9_executed_chrome": true,
    "D10_executed_chrome": false,
    "D9_executed_firefox": false,
    "D9_executed_safari": false,
    "D11_parsed_as_html_chrome": false,
    "D12_parsed_as_html_chrome": false,
    "D11_parsed_as_html_firefox": false,
    "D12_parsed_as_html_firefox": false,
    "D11_parsed_as_html_safari": false,
    "D12_parsed_as_html_safari": false,
    "browsers_measured": ["chrome", "firefox", "safari"]
  },
  "config_refs": []
}
```

## 読み方

**実ブラウザは同梱版の結果を追認しました。**

| classic worker が読み込んだ非 JavaScript MIME | 同梱版 | 実ブラウザ |
|---|:--:|:--:|
| Chromium 151.0.7922.34 / **Chrome 151.0.7922.170** | 5 / 6 | **5 / 6** |
| Firefox 153.0 / **Firefox 154.0** | 0 / 6 | **0 / 6** |
| WebKit 26.5 / **Safari 26.5.2** | 0 / 6 | **0 / 6** |

Firefox はメジャーが 1 つ違いますが（153 → 154）、**結果は変わりません**。Chrome が拒否する型も `image/png` の 1 つだけで一致しました。

destination 側も同じです——classic script は `nosniff` がなければ 3 種とも実行し、付ければ 3 種とも止まります。module script と style は `nosniff` なしでも止まります。document ナビゲーションは、実ブラウザ 3 種とも `<b>` 要素を生成しません。

> **測っていない範囲**: Firefox と Safari は Playwright から駆動できないため、ページ側で自己実行して結果を POST する方式です。同梱版は `page.evaluate` から直接測っており、**測り方が同じではありません**。document の対照は、実ブラウザ側では iframe 経由で読んでいます（同梱版はトップレベルのナビゲーション）。
