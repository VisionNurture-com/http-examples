# 005-shared-store-idempotency の期待値

記事に載せる値の正本。`results/005-shared-store-idempotency/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| サーバ | Express 5.2.1（Node 24.19.0）を 2 台（`app` = `localhost:8086` / `app2` = `localhost:8097`）。同じイメージ |
| 共有ストア | PostgreSQL 18.6 / Redis 8.10.2（どちらも 1 台）|
| クライアント | Node 24.21.0 の `fetch` |
| 経路 | Express 直（ロードバランサを挟まない）|
| 試行 | 各ケース 20 回 |
| 測定日 | 2026-10-03 |

## 実測結果

同じ冪等キーを付けた課金要求を、同時に 2 本送る。課金回数は両方の台から読んで足した値。
`2x20` は「20 回の試行すべてで 2」の意味。

| 実装 | 同じ台へ 2 本 | 別々の台へ 1 本ずつ |
|---|---|---|
| A: 素朴な実装 | 課金 2（201 / 201）| 課金 2（201 / 201）|
| B: プロセス内の排他 | 課金 1（201 / 409）| 🔴 **課金 2**（201 / 201）|
| **C: PostgreSQL の一意制約** | 課金 1（201 / 409）| **課金 1（201 / 409）** |
| **C: Redis の `SET NX`** | 課金 1（201 / 409）| **課金 1（201 / 409）** |

## 読み取り

B と C は判定の分岐が同じで、違うのは処理中のキーを覚えておく置き場所だけ。
**置き場所を 2 台から見える所へ移すと、別々の台へ届いた 2 本目も 409 で弾けた**（PostgreSQL・Redis とも 20 回すべて）。
2 本目は「結果を再生した 201」ではなく 409 で、課金は 1 回だった。

PostgreSQL の公式ドキュメントが高い並行性の下での原子性を明言しているのは `ON CONFLICT DO UPDATE` のほうで、
ここで使った `DO NOTHING` については、20 回の試行で 2 本目が挿入されなかったという**観測**にとどまる。
Redis は 1 台で測った。複数台の Redis やフェイルオーバーの下での挙動は測っていない。

```json
{
  "scenario": "005-shared-store-idempotency",
  "mode": "M1",
  "values": {
    "nodes": 2,
    "trials": 20,
    "a_same_instance_charged": "2x20",
    "a_two_instances_charged": "2x20",
    "b_same_instance_charged": "1x20",
    "b_two_instances_charged": "2x20",
    "b_two_instances_statuses": "201/201x20",
    "c_pg_same_instance_charged": "1x20",
    "c_pg_two_instances_charged": "1x20",
    "c_pg_two_instances_statuses": "201/409x20",
    "c_redis_same_instance_charged": "1x20",
    "c_redis_two_instances_charged": "1x20",
    "c_redis_two_instances_statuses": "201/409x20",
    "c_pg_protects_across_instances": true,
    "c_redis_protects_across_instances": true,
    "b_protects_across_instances": false
  },
  "config_refs": [
    {
      "path": "compose.yaml",
      "must_contain": ["image: postgres:18.6-alpine", "image: redis:8.10.2-alpine"]
    },
    {
      "path": "app/005-idempotency/schema.sql",
      "must_contain": ["key         text        PRIMARY KEY"]
    },
    {
      "path": "app/005-idempotency/routes.mjs",
      "must_contain": ["ON CONFLICT (key) DO NOTHING RETURNING key", "condition: \"NX\""]
    }
  ]
}
```
