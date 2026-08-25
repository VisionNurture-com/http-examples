# 009-redirect-origin — オリジンの境界はどこで切れるか

## 何を測るか

`Authorization` は「オリジン間のリダイレクトで取り除かれる」と説明されます。仕様の本文はこう規定しています。

> If request's current URL's origin is not same origin with locationURL's origin, then for each headerName of CORS non-wildcard request-header name, delete headerName from request's header list.
>
> I.e., the moment another origin is seen after the initial request, the `Authorization` header is removed.

オリジンは **スキーム・ホスト・ポート** の 3 つで決まります。ところが「オリジン間」としか書かれていないため、**どれが変わったときに落ちるのか**は文面からは分かりません。3 要素を 1 つずつ振り、2 ホップの経路も足して測ります。

本シナリオのクライアントは `curl` です。ブラウザは `009-redirect-browser`、各言語のランタイムは `009-redirect-clients` が担当します。

## 記事のどこに出るか

決定表「リダイレクトを越えると `Authorization` はどうなるか」の**実効値**欄。

## 判定

終端 `/009/whoami` が自分で報告した到着内容だけを読みます。`Authorization` は **あるか / ないか**とスキーム名だけを記録し、値そのものはログに残しません。

## 測れない範囲

**スキームだけを変えた対照はつくれません。**http は 80 番、https は 443 番を使うため、`B4` はスキーム差とポート差の複合になります。ポート差は `B2` が単独で押さえるため、`B4` が落ちても「スキームのせい」とは言いません。
