# 009-redirect-browser — オリジンの境界はどこで切れるか（ブラウザ）

## 何を測るか

`009-redirect-origin` と同じ 7 ケースを、ブラウザの `fetch` で測ります。仕様（WHATWG Fetch）はホップごとに直前のオリジンと比べ、違えば `Authorization` を**ヘッダの一覧から削除**すると規定しています。削除されたものは戻りません。

> I.e., the moment another origin is seen after the initial request, the `Authorization` header is removed.

`curl` がこの規定どおりに振る舞うとは限りません。**同じ 7 ケースを別のクライアントで測って突き合わせる**のが本シナリオの役目です。

## 記事のどこに出るか

決定表「リダイレクトを越えると `Authorization` はどうなるか」の**クライアント別**の列。

## 判定

**サーバ側の到着記録**で判定します。ブラウザの `fetch` が成功したかどうかだけでは、CORS で落ちたのか資格情報が消えたのかを区別できないためです。受け側は CORS を完全に許可し（`Access-Control-Allow-Headers` に `Authorization` を明示的に列挙）、CORS の失敗を測定から取り除いています。

`Authorization` は単純ヘッダではないため、クロスオリジンの各ホップで preflight が飛びます。preflight は資格情報を載せずに飛ぶので、**到着記録はメソッドで分けて数えます**。

## 測れない範囲

**ここで測ったのは Playwright が同梱するブラウザです。**実際に配布されているブラウザとは別物なので、`009-real-browsers` で本物でも測っています。
