# 012-early-hints — 記事に載せる値

> この表の値は `results/012-early-hints/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-early-hints",
  "mode": "M2",
  "values": {
    "think_ms": 200,
    "web_vitals_version": "6.1.1",
    "engines_measured": 3,
    "nginx_drops_interim": true,
    "web_vitals_reports_interim_as_ttfb": true,
    "webkit_cannot_separate_final_headers": true
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/012-compression.conf",
      "must_contain": [
        "location /012/eh {",
        "proxy_pass http://app_upstream;",
        "proxy_http_version 1.1;"
      ]
    }
  ]
}
```

## 読み方

- **`nginx_drops_interim`**: nginx（1.31.3・追加設定なし）は上流の 103 を客へ渡しません。直結では 3 エンジンとも 103 が届くのに、nginx を挟むと**全条件で届きません**。リバースプロキシに nginx を置いている限り、Early Hints は存在しないのと同じです
- **`web_vitals_reports_interim_as_ttfb`**: `web-vitals` 6.1.1 が返す TTFB は**報告 TTFB とミリ秒単位で一致**します。つまり RUM のダッシュボードには 103 の到着時刻が TTFB として並びます
- **`webkit_cannot_separate_final_headers`**: WebKit 26.5 は `finalResponseHeadersStart` を持っていますが、103 があるとき **`responseStart` と同じ値**を返します。2 つの時刻を分離できません
- **preload の実利得はエンジンと条件で変わります**（`summary.json` の `engines.<name>.preload_helps`）
  - Chrome 151: **HTTP/2 かつ保存可能な資源**のときだけ効く（2 つの条件が同時に要る）
  - Firefox 153: 4 条件すべてで効く
  - WebKit 26.5: どの条件でも効かない
- 🔴 **`bare`（描画に効かない 103）でも報告 TTFB は `preload` と同じだけ下がります**。値の動きは先読みの効果ではなく、最初の応答が早く届いたという事実だけを表しています
