# 004-retry-undici — 記事に載せる値

> この表の値は `results/004-retry-undici/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-retry-undici",
  "mode": "M1",
  "values": {
    "retry_after_seconds": 3,
    "undici_version": "8.10.0",
    "arrivals_u-node-fetch": 1,
    "verdict_u-node-fetch": "no_retry",
    "arrivals_u-undici-retry": 3,
    "gaps_u-undici-retry": [3, 3],
    "verdict_u-undici-retry": "waited"
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/004-status.conf",
      "must_contain": ["log_format s004 '$msec"]
    }
  ]
}
```

## 読み方

**同じ undici の上で、結果が分かれます。**

| クライアント | 到着回数 | 到着間隔 | 判定 |
|---|:--:|:--:|---|
| Node の組み込み `fetch` | 1 | — | 再送しない |
| undici `RetryAgent`（8.10.0） | 3 | 3 秒 / 3 秒 | **待って再送** |

Node の `fetch` は undici の上に載っていますが、再試行はしません。`RetryAgent` を明示的に噛ませたときだけ `Retry-After` に従います。

この 2 経路は `package-lock.json` と CI の Node が版を固定するため、**CI が毎回再実行して値を見張っています**。版に依存する `curl` の結果は [`004-retry-after`](../004-retry-after/README.md)（M2）にあります。
