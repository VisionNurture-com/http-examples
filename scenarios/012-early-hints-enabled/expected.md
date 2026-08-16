# 012-early-hints-enabled — 記事に載せる値

> この表の値は `results/012-early-hints-enabled/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-early-hints-enabled",
  "mode": "M2",
  "values": {
    "engines_measured": 3,
    "default_delivers_interim": false,
    "enabled_delivers_interim": true,
    "webkit_cannot_separate_final_headers_via_nginx": true
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/012-compression.conf",
      "must_contain": [
        "map $http_sec_fetch_mode $early_hints_on {",
        "navigate $http2$http3;",
        "early_hints $early_hints_on;"
      ]
    }
  ]
}
```

## 読み方

- **`default_delivers_interim`**: `early_hints` を書かない既定の状態では、3 エンジンのどれにも 103 が届きません。`012-early-hints` で 18 通りを測った結果と同じです
- **`enabled_delivers_interim`**: ディレクティブを 1 行書くと、**3 エンジンとも 103 が届くようになります**。届かなかったのは nginx の既定であって、経路の制約ではありません
- 🔴 **届くようになっても、画面に要る資源が早く来るとは限りません**。判定は報告 TTFB ではなく先読み対象の CSS の `responseEnd` で取っています（`summary.json` の `css_arrives_earlier_when_enabled`）
  - Chrome 151: 早まらない（本シナリオの資源は `no-store`。Chrome は保存できる資源のときだけ先読みを活かす）
  - Firefox 153: 早まる
  - WebKit 26.5: 早まらない
- **`webkit_cannot_separate_final_headers_via_nginx`**: WebKit 26.5 は 103 が届くと `finalResponseHeadersStart` が最初の応答と同じ値になります。nginx を挟んでも同じで、2 つの時刻を分離できません
- 時刻そのもの（ミリ秒）は実行のたびに動くため、本ファイルの突合対象にしていません。並びは `summary.json` の `engines.<name>.cases.<default|enabled>` にあります
