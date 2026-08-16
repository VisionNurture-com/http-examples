# 012-brotli-types — 記事に載せる値

> この表の値は `results/012-brotli-types/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-brotli-types",
  "mode": "M1",
  "values": {
    "image": "http-examples-brotli:1.28.3-r7",
    "nginx_package": "nginx-1.28.3-r7 (alpine 3.22)",
    "brotli_module_package": "nginx-mod-http-brotli-1.28.3-r7",
    "warns_on_implicit_text_html": true,
    "warns_on_repeated_type": true,
    "no_warning_without_duplication": true,
    "severity": "warn"
  }
}
```

## 読み方

- 🔴 **公式 nginx イメージには Brotli モジュールが入っていません。** Alpine の配布パッケージから版を固定して組んでいます。本体は Alpine の nginx **1.28.3（stable）**で、他のシナリオで使う公式 mainline **1.31.3** とは版が違います
- 警告の実物（`results/012-brotli-types/run.log` より）

```
nginx: [warn] duplicate MIME type "text/html" in /conf/nginx-a.conf:11
nginx: [warn] duplicate MIME type "text/css" in /conf/nginx-b.conf:11
```

- **`text/html` は常に対象**のため、`brotli_types` に書くと重複になります（case a）
- 同じ型を 2 回書いても同じ警告が出ます（case b）
- 重複がなければ警告は出ません（case c・対照）
- 🔴 重大度は **`warn`** で、`nginx -t` は 0 で終了します。**起動は止まりません**。設定ミスに気づかないまま動き続けます
