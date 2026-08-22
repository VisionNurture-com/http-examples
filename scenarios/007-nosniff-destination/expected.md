# 007-nosniff-destination — 記事に載せる値

> この表の値は `results/007-nosniff-destination/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "007-nosniff-destination",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "D1_executed_all": "all",
    "D2_executed_all": "none",
    "D3_executed_all": "all",
    "D4_executed_all": "none",
    "D5_executed_all": "none",
    "D6_executed_all": "none",
    "D7_executed_all": "none",
    "D8_executed_all": "none",
    "D9_executed_all": "split",
    "D10_executed_all": "none",
    "D11_content_type_all": "text/plain",
    "D11_parsed_as_html_any": false,
    "D12_content_type_all": "text/plain",
    "D12_parsed_as_html_any": false
  },
  "config_refs": []
}
```

## 読み方

**「型を偽ると止まる」は destination で割れます。**

| destination | 配った型 | `nosniff` なし | `nosniff` あり |
|---|---|:--:|:--:|
| classic script | `text/html` | **実行される** | 止まる |
| classic script | `text/plain` | **実行される** | 止まる |
| module script | `text/html` | 止まる | 止まる |
| style | `text/plain` | 止まる | 止まる |
| classic worker | `text/html` | **エンジンで割れる** | 止まる |
| document | `text/plain`（HTML 本文） | **止まらない** | **止まらない** |

3 エンジン（Chromium 151 / Firefox 153 / WebKit 26.5）で一致しない欄は **classic worker の 1 つだけ**です。内訳は [`007-worker-mime`](../007-worker-mime/README.md) で型を振って確定させました。

**document は対照です。**`text/plain` で `<b>bold</b>` を返しても、3 エンジンとも `document.contentType` は `text/plain` のままで、`<b>` 要素は生成されません。`nosniff` を付けても結果は同じです。**`nosniff` はドキュメントを守るヘッダではありません。**

classic script だけが `nosniff` の有無で変わるのは、仕様が classic script にだけ MIME 検査を課していないためです。module script と style は、`nosniff` を付けなくても型が合わなければ読み込まれません。
