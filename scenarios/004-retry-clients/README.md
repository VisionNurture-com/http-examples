# 004-retry-clients — 言語を変えても待ってくれるか

## 何を測るか

[`004-retry-after`](../004-retry-after/README.md) は `curl` と Node の 4 経路を測りました。ここでは**言語を変えて 6 経路**を足し、「`Retry-After` に従うのは実装の既定か、それとも明示的な設定か」を切り分けます。

| クライアント | 立場 |
|---|---|
| Python `urllib3` の `Retry`（`status_forcelist=[429]`） | 再試行を明示的に設定した側 |
| Python `requests` | 同じ `urllib3` の上に載る素の呼び出し |
| Java `java.net.http.HttpClient` | 再試行の設定なし |
| Go `net/http` | 再試行の設定なし |
| Ruby `Net::HTTP` | 再試行の設定なし |
| Bun の `fetch` | Web 標準の `fetch` |

実行するコードは [`tools/004-clients/`](../../tools/004-clients/) に置いてあります。記事はここから引用します。

## 判定

サーバ側の到着間隔（nginx の `$msec`）で 3 値判定します（`no_retry` / `immediate` / `waited`）。クライアントが自分で報告した待ち時間は使いません。

## 記事のどこに出るか

実効値の表「Retry-After に従うのは誰か」。「`Retry-After` を付ければ待ってもらえる」の反証を、言語をまたいで固める箇所。

## 実行

```bash
bash scenarios/004-retry-clients/run.sh
```
