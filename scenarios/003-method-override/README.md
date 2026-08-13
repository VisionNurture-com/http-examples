# 003-method-override

form が実際にワイヤへ送るメソッドを、実ブラウザ 3 エンジンで測ります。

## 何を測るか

`public/003/override.html` の 4 つの form を 1 つずつ submit し、届いたメソッドを記録します。

| ケース | 書き方 |
|---|---|
| `form_post_override` | `<form method="post" action="...?_method=PUT">` |
| `form_put_attr` | `<form method="PUT">` |
| `form_post_plain` | `<form method="post">`（対照）|
| `form_get_plain` | `<form method="get">`（対照）|
| `fetch_put` | `fetch(..., {method:"PUT"})`（対照）|

記録は 2 系統で取ります。アプリ側の `req.originalMethod`（書き換え前のメソッド）と、nginx の `$request_method` です。

## 実行

```bash
docker compose up -d --wait
npx playwright install
bash scenarios/003-method-override/run.sh
```

## 測り方の注意

- **fetch では代用できません。** 測っているのは「ブラウザが form をどう送るか」なので、実際に submit してナビゲーションを起こす必要があります
- GET として送られる form は、action に書いたクエリを捨ててフォームデータで置き換えます。そのため `form_put_attr` と `form_get_plain` のケース識別子は hidden で持たせています
- submit 後は「URL が変わったこと」を待ちます。`waitForLoadState` はページがすでに load 済みだと即座に解決し、次の遷移が飛行中の送信を打ち切ります（実際に WebKit で 1 件が届かず、エンジン差に見えかけました）
