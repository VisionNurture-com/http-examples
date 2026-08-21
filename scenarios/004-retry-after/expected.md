# 004-retry-after — 記事に載せる値

> この表の値は `results/004-retry-after/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-retry-after",
  "mode": "M2",
  "values": {
    "retry_after_seconds": 3,
    "curl_version": "8.21.0",
    "arrivals_curl-plain": 1,
    "verdict_curl-plain": "no_retry",
    "arrivals_curl-retry": 3,
    "gaps_curl-retry": [3, 3],
    "verdict_curl-retry": "waited",
    "arrivals_node-fetch": 1,
    "verdict_node-fetch": "no_retry",
    "arrivals_undici-retry": 3,
    "gaps_undici-retry": [3, 3],
    "verdict_undici-retry": "waited"
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/004-status.conf",
      "must_contain": ["log_format s004 '$msec", "access_log /results/004-status/access.log s004;"]
    }
  ]
}
```

## 読み方

`Retry-After: 3` を返したとき、**待って再送したのは 4 種類中 2 種類**でした。

| クライアント | 到着回数 | 到着間隔 | 判定 |
|---|:--:|:--:|---|
| `curl`（素） | 1 | — | 再送しない |
| `curl --retry 2` | 3 | 3 秒 / 3 秒 | **待って再送** |
| Node の組み込み `fetch` | 1 | — | 再送しない |
| undici `RetryAgent` | 3 | 3 秒 / 3 秒 | **待って再送** |

- 🔴 **同じ undici でも結果が分かれます。**Node の組み込み `fetch` は undici の上に載っていますが、再試行はしません。`RetryAgent` を明示的に噛ませたときだけ `Retry-After` に従います
- `curl` も同じで、**`--retry` を付けたときだけ**です。素の `curl` は 1 回で終わります
- つまり `Retry-After` に従うのは「そう作られたクライアント」だけで、**付ければ待ってもらえる、という性質のヘッダではありません**

> 🔴 **curl の結果は環境に依存します。**上の値は **curl 8.21.0**（macOS・Release-Date 2026-06-24）で測ったものです。**GitHub Actions の runner に入っている curl 8.5.0（Ubuntu）では、同じ `--retry 2` でも再送しませんでした**（2026-08-20 の CI が実測で検出。到着 1 回 / 判定 `no_retry`）。
>
> ⏸ **原因は未特定です。**両方の版のドキュメントは同じ文言で 429 を transient error に挙げています（`docs/cmdline-opts/retry` を curl-8_5_0 と master で確認）。ディストリビューションのパッチによるものか実装差かは**未検証**です。
>
> **ドキュメントに書かれていることと、手元の実行ファイルの挙動は別物です。**
>
> このため本シナリオは **CI の突合から外して M2** にしています。リポジトリが `package-lock.json` で版を固定できる Node 側の 2 経路は [`004-retry-undici`](../004-retry-undici/README.md)（M1）が CI で見張ります。
