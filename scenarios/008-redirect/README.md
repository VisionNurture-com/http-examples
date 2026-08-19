# 008-redirect — リダイレクトを挟んだときの壊れ方

## 何を測るか

「ローカルでは通るのに本番だけ落ちる」の典型です。本番の手前にリバースプロキシや末尾スラッシュ補完の 301 が入ると挙動が変わります。仕様で確認済みの 2 点を、実装が守っているかを見ます。

1. preflight のエントリ作成条件は「CORS check が成功し、かつ `response's status is an ok status`」。**301 は ok status ではない**
2. > I.e., the moment another origin is seen after the initial request, the `Authorization` header is removed.

## 記事のどこに出るか

実効値の表「リダイレクトを挟むと何が起きるか」の**実効値**欄。

## 判定

ブラウザ側の fetch 結果 + サーバ側の到着記録。第 3 のオリジン（`:8083`）には **preflight（OPTIONS）も届く**ため、両方を数えます。あわせて、リダイレクト後に送られる `Origin` の値と `Authorization` の有無を記録します。

`Authorization` は「あるか / ないか」だけを記録し、値そのものはログに残しません。
