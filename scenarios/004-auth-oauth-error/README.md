# 004-auth-oauth-error — 403 に challenge が付く側を測る

## 何を測るか

`004-auth-challenge` の 8 アームは、**challenge を持たない 403**（Express の認可判断・nginx の `deny`）だけを測っていました。その結果だけを見ると「403 に challenge は付かない」と読めますが、これは一般則ではありません。

RFC 6750 §3 は、**アクセスを許さないトークンで来た要求にも `WWW-Authenticate` を MUST** とし、§3.1 は `invalid_token` に **401 を SHOULD**、`insufficient_scope` に **403 を SHOULD**（`scope` 属性は MAY）と定めています。ここは対になる側を測ります。

| アーム | 返す側 | 期待 |
|---|---|---|
| `app_401_invalid_token` | Express | 401 + `error="invalid_token"` |
| `app_403_insufficient_scope` | Express | 403 + `error="insufficient_scope"` + `scope` |
| `app_403_plain` | Express（対照） | 403・challenge なし |
| `edge_403_insufficient_scope` | nginx→Express | 前段を越えて残るか |
| `waf_403_insufficient_scope` | WAF→Express | WAF を越えて残るか |
| `stripped_403_insufficient_scope` | nginx（`proxy_hide_header`） | 剥がされるか |

## なぜ前段越しのアームを置くか

`004-waf` は、WAF が **403 のときだけ** `Content-Type` を `text/html` へ書き換えることを測っています。403 に challenge を載せた場合も同じ扱いになるのか、それともヘッダは残るのかは、そのアームからは分かりません。**403 に何かを載せて届けたい実装にとって、そこが実際の分かれ目**になります。

## 判定

curl で 1 回ずつ叩き、応答コード・`WWW-Authenticate`・`Content-Type`・本文を記録します。

## 記事のどこに出るか

sec02（401 に添えるもの）と sec07 の決定表（403 の行）。

## 実行

```bash
bash scenarios/004-auth-oauth-error/run.sh
```
