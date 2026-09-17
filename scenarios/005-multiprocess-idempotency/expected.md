# 005-multiprocess-idempotency の期待値

記事に載せる値の正本。`results/005-multiprocess-idempotency/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| Express | 5.2.1（Node 24.19.0）|
| インスタンス | 2 台（`app` = `localhost:8086` / `app2` = `localhost:8097`）。同じイメージ |
| 経路 | Express 直（ロードバランサを挟まない）|
| 測定日 | 2026-09-16 |

**ロードバランサを挟んでいないのは意図的**です。振り分けの運不運に結果が左右されると、
「たまたま同じ台に落ちたから弾けた」のか「排他が効いた」のかを分けられません。
2 本をそれぞれ別のインスタンスへ直接送れば、機序をそのまま観測できます。

課金回数もプロセス内の変数なので、**両方のインスタンスから読んで足しています**。

## 実測結果

同じ冪等キーを付けた課金要求を、同時に 2 本送ります。

| 実装 | 宛先 | 応答 | 課金回数（app + app2）|
|---|---|---|:--:|
| A: 素朴な実装 | 同じインスタンスへ 2 本 | 201 / 201 | **2**（2 + 0）|
| A: 素朴な実装 | 別インスタンスへ 1 本ずつ | 201 / 201 | **2**（1 + 1）|
| B: v07 準拠 | 同じインスタンスへ 2 本 | **409** / 201 | **1**（1 + 0）|
| **B: v07 準拠** | **別インスタンスへ 1 本ずつ** | **201 / 201** | 🔴 **2**（1 + 1）|

**B は同じ台なら 409 で 2 本目を弾きますが、台が分かれると弾けません。**

## 読み取り

記事 005 は「キーの生成・保存・排他」の 3 か所を柱に据え、排他を `const inFlight = new Set()` で実装しています。
この変数はプロセスの中にしかないため、**サーバを 2 台に並べた時点で 2 本目が見えなくなります**。

しかも**応答は 201 が 2 つ返るだけ**で、呼び出し側には異常が残りません。
記事 004 で扱った K2（同じキーで金額だけ変える）と同じ型の、静かな失敗です。

仕様どおりに書いた実装でも、**置き場所を変えなければ台数分だけ二重登録が起きます**。
排他の置き場所を全台から見える所（データベースの一意制約・分散ロック等）へ移す必要がありますが、
**どの置き場所が良いかはここでは測っていません**。測ったのは「プロセス内では足りない」ことだけです。

```json
{
  "scenario": "005-multiprocess-idempotency",
  "mode": "M1",
  "values": {
    "nodes": 2,
    "a_same_instance_charged": 2,
    "a_two_instances_charged": 2,
    "b_same_instance_charged": 1,
    "b_two_instances_charged": 2,
    "b_same_instance_statuses": "201,409",
    "b_two_instances_statuses": "201,201",
    "spec_impl_protects_single_instance": true,
    "spec_impl_protects_across_instances": false
  },
  "config_refs": [
    {
      "path": "compose.yaml",
      "must_contain": ["container_name: http-examples-app2", "8097:3000"]
    },
    {
      "path": "app/005-idempotency/routes.mjs",
      "must_contain": ["const inFlight = new Set()"]
    }
  ]
}
```
