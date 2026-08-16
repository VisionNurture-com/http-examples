# 012-lighthouse-ttfb — 記事に載せる値

> この表の値は `results/012-lighthouse-ttfb/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-lighthouse-ttfb",
  "mode": "M1",
  "values": {
    "lighthouse_version": "13.4.1",
    "samples": 3,
    "server_response_time_collapses_with_interim": true,
    "paint_metrics_improve_with_interim": false,
    "report_breaks_with_interim": false
  },
  "config_refs": [
    {
      "path": "app/012-compression/routes.mjs",
      "must_contain": [
        "if (hints === \"preload\") res.writeEarlyHints({ link: [`<${assetUrl(cc, nonce)}>; rel=preload; as=style`] });"
      ]
    }
  ]
}
```

## 読み方

- **`server_response_time_collapses_with_interim`**: Lighthouse の `server-response-time`（レポート上は "Root document took N ms"）は、103 を送るだけで **205 ミリ秒から 1 ミリ秒**へ落ちます。サーバは同じだけ待たせているので、落ちたのは待ち時間ではなく**測り始めの位置**です
- **`paint_metrics_improve_with_interim`**: 同じ実行で取った LCP は **1,211 → 1,220 ミリ秒**、FCP は **1,061 → 1,070 ミリ秒**で、どちらも改善していません。**サーバ応答時間の指摘だけが消えて、画面の速さは変わらない**という形です
- **`report_breaks_with_interim`**: 103 を送るとレポートが `NOT_HTML` で失敗する報告が [2021 年にあり](https://github.com/GoogleChrome/lighthouse/issues/13379)（同年 12 月に close）、13.4.1 では再現しませんでした。**壊れないからこそ、値が動いたことに気づきにくい**とも読めます
- ミリ秒そのものは実行のたびに動くため、突合対象は上の 3 つの判定（真偽）と版・回数にしています。実測の並びは `summary.json` の `cases.<none|preload>.server_response_time_ms` にあります
- 🔴 **アプリへ直結して測っています**。nginx は既定で上流の 103 を落とすため（`012-early-hints`）、経路に挟むと「103 あり」の条件そのものが作れません

## 再現手順

```bash
docker compose up -d
node tools/measure-012-lighthouse-ttfb.mjs
```
