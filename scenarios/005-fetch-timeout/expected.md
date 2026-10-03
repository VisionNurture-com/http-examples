# 005-fetch-timeout の期待値

記事に載せる値の正本。`results/005-fetch-timeout/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| クライアント（組み込みの `fetch` を動かす側）| **Node 24.21.0**（同梱の undici **7.29.1**）|
| `undici` を直接 | npm の undici **8.10.0**（組み込みの `fetch` が使う同梱の undici とは別の版）|
| curl | **8.7.1**（macOS に同梱されているもの）|
| サーバ（応答を返さない口）| Express 5.2.1（Node 24.19.0）。待ちの既定を決めるのはクライアント側で、サーバの版は観測値を決めない |
| 上限 | 330 秒 |
| 測定日 | macOS = **2026-10-03** / Ubuntu = 2026-08-25 |
| 測定環境 | macOS（手元・arm64）と Ubuntu（GitHub Actions・x86_64）の 2 つ |
| 足場 | `GET /005/never-responds`（接続は成立・応答は返さない）|

🔴 **2026-08-25 の測定は、クライアント側の版を記録していませんでした。**当時の記録にあった Node 24.19.0 はサーバ（アプリのコンテナ）の版で、組み込みの `fetch` を動かした側の版ではありません。macOS は 2026-10-03 に、クライアント側の版を記録するよう直してから測り直しました。Ubuntu の列は 2026-08-25 のままで、クライアント側の版は分かりません。

## 実測結果

| クライアント | 経過（macOS）| 経過（Ubuntu）| 結果 | エラー |
|---|---:|---:|---|---|
| Node 組み込みの `fetch`（同梱の undici）| 301.4 秒 | 300.7 秒 | 切れた | `TypeError` / `UND_ERR_HEADERS_TIMEOUT` |
| `undici` を直接（npm の undici）| 301.4 秒 | 300.6 秒 | 切れた | `HeadersTimeoutError` / `UND_ERR_HEADERS_TIMEOUT` |
| `curl` 既定（`--max-time` なし）| 330 秒 | 330 秒 | 🔴 **上限まで切れなかった** | — |

**3 種のうち、既定で切れたのは 2 種**でした。切れた 2 種はどちらも **約 300 秒**です。

🔴 **秒数は突合に載せていません。**経過秒は環境ごとに揺れるためです（版や環境で動く値は、CI の突合に載せない）。**記事に書くのは「約 300 秒」までで、小数点以下は書きません。**

## 読み取り

**Node の `fetch` は `AbortController` を付けなくても切れます。**約 300 秒で `UND_ERR_HEADERS_TIMEOUT` を投げました。組み込みの `fetch`（同梱の undici 7.29.1）と、npm で入れた undici 8.10.0 を直接呼んだ場合は、**系列の違う 2 つの undici がどちらも約 300 秒で切れました**。ヘッダ待ちの既定（`headersTimeout`）が、どちらの系列でも 300 秒だったためです。**macOS と Ubuntu で 0.5 秒しか違いません**（301.1 / 300.7）。

**`curl` は既定で切れません。**330 秒待っても終わりませんでした。`--max-time` を付けない限り待ち続けます。

🔴 **この差が「サーバ側が切ったのではない」ことの証拠にもなっています。**同じ足場に同じ時間当てて curl が切れなかった以上、300 秒で接続を落としたのはサーバではなく Node 側のクライアントです。

エラーの名前が `HeadersTimeout` であることも読み取れます。切れたのは**応答ヘッダが返ってこないこと**に対するタイムアウトで、本文の受信中に固まった場合は別の値が効きます。

```json
{
  "scenario": "005-fetch-timeout",
  "mode": "M2",
  "values": {
    "node_fetch_outcome": "クライアント側で切れた",
    "node_fetch_error": "TypeError / UND_ERR_HEADERS_TIMEOUT",
    "undici_outcome": "クライアント側で切れた",
    "undici_error": "HeadersTimeoutError / UND_ERR_HEADERS_TIMEOUT",
    "curl_elapsed_s": 330,
    "curl_outcome": "上限 330.0 秒まで切れなかった",
    "curl_error": null,
    "timed_out_clients": ["node_fetch", "undici"],
    "timed_out_count": 2,
    "clients_total": 3,
    "cap_ms": 330000
  }
}
```
