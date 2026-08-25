# 005-idempotency-compliance — 冪等キーを付けたのに二重登録が起きる境界

## 何を測るか

`Idempotency-Key` は「デファクト標準」と呼ばれます。実体は **2026-04-18 に失効した IETF ドラフト**（`draft-ietf-httpapi-idempotency-key-header-07`）と、それを各社が真似た実装の集まりです。

ドラフトは 3 つのステータスコードを SHOULD で定めています。

> Concurrent Request: The request was retried before the original request completed. The resource **SHOULD** respond with a resource conflict error.（→ **409**）

> If there is an attempt to reuse an idempotency key with a different request payload, the resource **SHOULD** reply with a HTTP **422** status code with body containing a link pointing to relevant documentation.

キーが無い場合は **400** を返す例が示されています。

一方、**保存期間の具体値は定めていません**。

> The resource **MAY** require time based idempotency keys to be able to purge or delete a key upon its expiry. The resource **SHOULD** define such expiration policy and publish it in the documentation.

そこで **A / B 対照**を同じサーバに並べ、同じ攻め方を両方へ当てます。

| 側 | エンドポイント | 中身 |
|---|---|---|
| **A** | `/005/charge-naive` | 素朴な実装。キーは見るが、別ペイロードの検出も処理中の排他も期限もない |
| **B** | `/005/charge` | ドラフト v07 準拠 |

## 記事のどこに出るか

決定表「失敗の種類 × 副作用の有無 → 再送可否 / キーの要否」の**実効値**欄。

## 判定

サーバが自分で数えた**課金処理の回数**（`/005/__stats` の `charged`）と、返ったステータスコードだけを読みます。ケースごとに `__reset` を呼んで前のケースの保存内容を持ち込みません。

## 🔴 処理に非同期の間を入れている理由

課金処理には `await` を 1 つ挟んでいます。**これが無いと同時 2 本が再現しません。**Express は単一プロセスのイベントループで動くため、ハンドラが同期的だと 2 本目は 1 本目の完了後に処理され、素朴な実装でも二重登録が起きません。実サービスは DB 書き込みで必ず非同期の間が入るため、これは現実の模写です。

**「Express なら素朴な実装でも安全」ではありません。**間が無いように見えるのは、この足場が同期的に書かれていた場合だけです。

## 測れない範囲

- **実在のサービス（Stripe 等）の実挙動は測っていません。**ここで測ったのは、ドラフトどおりに書いた実装と、素朴に書いた実装の 2 つだけです
- **保存期間の秒数は測定用に縮めた値**で、記事に載せる実効値ではありません。ドラフトは値を定めていないため、秒数は実装ごとの選択です
- 複数プロセス・複数インスタンスへ分散した場合は測っていません（プロセス内 `Map` で保存しているため）
