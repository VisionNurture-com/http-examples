# 003-query-method の期待値

記事に載せる値の正本。`results/003-query-method/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| nginx | 1.31.6-alpine |
| Node.js / Express | 24.19.0 / 5.2.1 |
| curl | 8.22.0（ホストに入っていたもの） |
| 入口 | `http://localhost:8085` |
| 測定日 | 2026-09-16 |

## 実測結果

### ① 仕様の分類は、実装の保証ではない

同じ本文の QUERY を 3 回送り、そのたびにサーバの状態（`GET /003/state` の `quota`）を読み出した。

| 実装 | 3 回送ったあとの状態の通り数 | 応答 | 冪等か |
|---|:--:|---|:--:|
| 読むだけ（`/003/query/search`）| **1** | 200 / 200 / 200 | ✅ |
| 読むだけのつもりで数を進める（`/003/query/counted`）| **3** | 200 / 200 / 200 | ❌ |

**応答はどちらも 200 が 3 回**で、そこからは区別できない。数を進める実装では `quota` が 3 まで伸びた。

[RFC 10008](https://www.rfc-editor.org/rfc/rfc10008.html) は QUERY を safe かつ idempotent と定め、IANA の
HTTP Method Registry にも Safe = yes / Idempotent = yes で登録されている。**それでも 2 つ目の実装は冪等ではない。**
PUT で測ったのと同じことが、新しいメソッドでもそのまま起きる。

### ② メソッド名を小文字で書くと、道具によって結果が変わる

| 送った語 | `curl -X` | Node の `fetch` |
|---|:--:|:--:|
| `QUERY` | 200 | 200 |
| **`query`** | **400** | **400** |
| `GET` | 200 | 200 |
| **`get`** | **400** | **200** |

`curl` は書いたとおりに送るため、`get` も `query` も nginx が 400 で弾く。

一方 Fetch 標準が大文字へ正規化するのは **`DELETE` / `GET` / `HEAD` / `OPTIONS` / `POST` / `PUT` の 6 語だけ**で、
`QUERY` はそこに含まれない。そのため `fetch` では `get` だけが通り、`query` は書いたとおり送られて 400 になる。

**同じ「小文字で書いた」という 1 つの間違いが、道具によって別の結果になる。**

## 読み取り

記事 003 は「送ったつもりのメソッドが届かない場所」を 3 か所（送る前 / 届くまでの途中 / サーバの中）挙げている。
**メソッド名の大文字小文字はその 4 か所目**にあたり、しかも新しいメソッドでだけ表に出る。
GET や POST では正規化に救われるため、QUERY を使い始めた読者が最初に踏む。

```json
{
  "scenario": "003-query-method",
  "mode": "M1",
  "values": {
    "sends_per_variant": 3,
    "read_distinct_states": 1,
    "counted_distinct_states": 3,
    "counted_final_quota": 3,
    "case_probe_upper_query_status": 200,
    "case_probe_lower_query_status": 400,
    "case_probe_upper_get_status": 200,
    "case_probe_lower_get_status": 400,
    "fetch_probe_upper_query_status": 200,
    "fetch_probe_lower_query_status": 400,
    "fetch_probe_upper_get_status": 200,
    "fetch_probe_lower_get_status": 200
  },
  "config_refs": [
    {
      "path": "app/003-methods/routes.mjs",
      "must_contain": ["/003/query/search", "/003/query/counted", "req.method !== \"QUERY\""]
    }
  ]
}
```
