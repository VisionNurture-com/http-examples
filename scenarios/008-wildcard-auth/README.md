# 008-wildcard-auth — Allow-Headers の `*` と `Authorization`

## 何を測るか

仕様（WHATWG Fetch）で `Authorization` だけが特別扱いされています。

> A **CORS non-wildcard request-header name** is a header name that is a byte-case-insensitive match for `Authorization`.

ここから 2 つの帰結が導かれます。

1. preflight 応答の `Access-Control-Allow-Headers` が `*` でも `Authorization` は覆われず、network error になる
2. `*` のキャッシュエントリは `Authorization` にマッチしない（毎回 preflight が飛ぶ）

実装が追随しているかを測ります。あわせて [whatwg/fetch#1278](https://github.com/whatwg/fetch/issues/1278)（2021-08 報告・OPEN）の症状が現行版でも再現するかを確認します。報告者は「Safari では preflight が見えないので検証できなかった」と書いており、その欄をサーバ側の記録で埋めます。

## 記事のどこに出るか

実効値の表「`*` は `Authorization` を覆わない」の**実効値**欄。

## 判定

**2 系統**で見ます。片方だけでは判定できません。

| 系統 | 見るもの |
|---|---|
| サーバ側の OPTIONS 到着記録 | preflight が飛んだか |
| ブラウザ側の fetch 結果 | 本番リクエストが通ったか |

`*` + `Authorization` は「OPTIONS が届いたうえで応答検査に落ちる」形になりうるため、到着記録だけでは成否が分かりません。
