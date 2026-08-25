# 009-redirect-clients の期待値

記事に載せる値の正本。`results/009-redirect-clients/summary.json` と突合される。

## 実測の条件

| クライアント | 版 |
|---|---|
| curl | 8.21.0（`--location`）|
| python `requests` | Python 3.14.7 / requests 2.34.2 |
| `java.net.http.HttpClient` | OpenJDK 25.0.4 LTS（`followRedirects(NORMAL)`）|
| Go `net/http` | go1.27.0 |
| Ruby `open-uri` | ruby 3.4.10 |
| Ruby `open-uri` + `request_specific_fields` | ruby 3.4.10（宛先を検査する書き方）|
| Node `fetch`（undici）| v24.19.0 |
| Bun `fetch` | 1.4.0 |

測定日: 2026-08-23

> 🔴 **版はこのリポジトリで固定していません。**5 つのクライアント（python / java / go / ruby / bun）はホストの `PATH` から解決され、`tools/measure-009-clients.mjs` が実行時に版を読み取って `summary.json` へ記録します。手元の版が違えば結果も変わりえます。

## 実測結果

`Authorization: Bearer …` を付けて送り、終端に届いたかを読みます。

| ケース | 変わるもの | curl | python | java | **Go** | **Ruby** | Ruby+検査 | node | bun |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| B0 | 対照 | 届 | 届 | 届 | 届 | 届 | 届 | 届 | 届 |
| B1 | パスのみ | 届 | 届 | 届 | 届 | 届 | 届 | 届 | 届 |
| **B2** | **ポートだけ** | 落 | 落 | 落 | 🔴 **届** | 🔴 **届** | 落 | 落 | 落 |
| **B3** | **ホストだけ** | 落 | 落 | 落 | 落 | 🔴 **届** | 落 | 落 | 落 |
| **B4** | スキーム + ポート | 落 | 落 | 落 | 🔴 **届** | 🔴 **届** | 落 | 落 | 落 |
| **B5** | **元のオリジンへ復帰** | 🔴 **届** | 落 | 落 | 🔴 **届** | 🔴 **届** | 届 | 落 | 落 |
| **B6** | 同一 → 別 | 落 | 落 | 落 | 🔴 **届** | 🔴 **届** | 落 | 落 | 落 |
| **B7** | **サブドメイン** | 落 | 落 | 落 | 🔴 **届** | 🔴 **届** | 落 | 落 | 落 |

## 読み取り

**8 ケースのうち 6 ケースで、クライアントによって結果が割れました。**同じサーバの同じ経路でも、どのクライアントで叩くかによって資格情報が届いたり届かなかったりします。

判定に使っている基準が 5 通りに分かれています。

| 基準 | クライアント | 分かること |
|---|---|---|
| **オリジン**（スキーム + ホスト + ポート）| python / java / node / bun | ブラウザと同じ。いちど落ちたら復活しない |
| **オリジン。ただし復活する** | curl | B5 で元のオリジンへ戻ると再び送る。削除ではなく「そのホップで送るかどうか」の判断 |
| 🔴 **ドメイン**（完全一致 **または サブドメイン**）| **Go `net/http`** | ポートが変わってもスキームが変わっても送る。**サブドメインへも送る**（B7）。落とすのはドメインそのものが変わったときだけ（B3）|
| 🔴 **何も見ない** | **Ruby `open-uri`**（素の書き方）| 8 ケースすべてで送る。**別ホストへも資格情報が出ていく** |
| **宛先を検査する** | Ruby `open-uri` + `request_specific_fields` | 同じ `open-uri` でも、宛先を見て出し分ければ止まる。B5 で届くのは**戻った先が最初のオリジンだから** |

**ホストだけが違うリダイレクト（B3）で資格情報を送ったのは、素の書き方の Ruby `open-uri` だけ**でした。これは「リダイレクト先を信頼してよいか」をライブラリが判断していないということです。

**Go の基準はドメインです。オリジンではありません。**公式ドキュメントは次のように規定しています。

> These headers will be ignored when following a redirect to a domain that is not a subdomain match or exact match of the initial domain.

B2（ポートだけ）と B4（スキーム + ポート）で送るのはドメインが同じだからで、**B7（サブドメイン）でも送ります**。落ちるのは B3 のようにドメインそのものが変わったときだけです。比較の相手も**最初のドメイン**であり、`curl` のようにホップごとに判断しているわけではありません。対象ヘッダも `Authorization` / `WWW-Authenticate` / `Cookie` の 3 つで、仕様（Fetch）が削除対象とする `Authorization` 1 つとは範囲が違います。

**Ruby には止める書き方があります。**`open-uri` の `request_specific_fields` に Proc を渡すと、リダイレクトを含む各リクエストの直前に宛先で評価されるため、行き先を見てヘッダを出し分けられます。素の書き方との差は B2 / B3 / B4 / B6 / B7 の 5 ケースに出ました。

```json
{
  "scenario": "009-redirect-clients",
  "mode": "M2",
  "values": {
    "cases_total": 8,
    "clients_total": 8,
    "diverged_count": 6,
    "diverged_cases": ["B2", "B3", "B4", "B5", "B6", "B7"],
    "sent_to_other_host": ["ruby-openuri"],
    "B2_go-nethttp": "yes",
    "B2_curl": "no",
    "B2_node-fetch": "no",
    "B2_ruby-openuri-guarded": "no",
    "B3_ruby-openuri": "yes",
    "B3_ruby-openuri-guarded": "no",
    "B3_go-nethttp": "no",
    "B4_go-nethttp": "yes",
    "B5_curl": "yes",
    "B5_node-fetch": "no",
    "B5_java-httpclient": "no",
    "B5_ruby-openuri-guarded": "yes",
    "B6_go-nethttp": "yes",
    "B6_ruby-openuri": "yes",
    "B7_go-nethttp": "yes",
    "B7_curl": "no",
    "B7_python-requests": "no",
    "B7_node-fetch": "no",
    "B7_ruby-openuri": "yes",
    "B7_ruby-openuri-guarded": "no",
    "B0_clients_agree": true,
    "B1_clients_agree": true,
    "B3_clients_agree": false,
    "B7_clients_agree": false
  },
  "config_refs": [
    { "path": "tools/009-clients/follow.go", "must_contain": ["MEASUREMENT-TOKEN"] },
    { "path": "tools/009-clients/follow.rb", "must_contain": ["open-uri"] },
    { "path": "tools/009-clients/follow_guarded.rb", "must_contain": ["request_specific_fields"] }
  ]
}
```
