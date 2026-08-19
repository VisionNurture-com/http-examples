# 008-preflight-boundary — preflight はどこから飛ぶか

## 何を測るか

同じ「1 回のリクエスト」に見えても、条件を少し変えるだけでブラウザは事前に OPTIONS を送る（preflight）。その境界がどこにあるかを 8 通りで実測する。

読者が踏みやすいのは `Content-Type` で、`text/plain` なら飛ばないのに `application/json` にした瞬間に飛ぶ。API を JSON にしただけでリクエスト数が倍になる。

## 記事のどこに出るか

実効値の表「preflight の発生境界」の**実効値**欄。

## 実行モード

**M2**（実ブラウザ）。preflight が飛んだかどうかはブラウザ内部から観測できないため、サーバ側の OPTIONS 到着記録で判定する。

## 測り方

- ページは `http://localhost:8080`、API は `http://localhost:8081`。**ポートが違うので別オリジン**になる
- ケースごとにブラウザのコンテキストを作り直す。preflight キャッシュを持ち越すと 2 件目以降の OPTIONS が届かず、誤って「preflight なし」と読んでしまう
- ケースごとに別パス（`/008/boundary/<id>`）を使い、記録が混ざらないようにする
