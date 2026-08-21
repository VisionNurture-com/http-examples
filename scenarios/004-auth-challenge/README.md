# 004-auth-challenge — 401 は 1 種類ではない

## 何を測るか

RFC 9110 §15.5.2 は、401 を返すサーバに `WWW-Authenticate` の送信を **MUST** と定めています。同じ「入れない」を返す 8 つの経路で、実際に何が添えられるかを測ります。

| アーム | 返す側 | challenge |
|---|---|---|
| `app_none` | Express（仕様違反のアーム） | 付けない |
| `app_basic` / `app_bearer` | Express | `Basic` / `Bearer` |
| `app_forbidden` | Express | 403 |
| `edge_basic` | nginx→Express | そのまま通す |
| `stripped_basic` | nginx（`proxy_hide_header`） | 剥がす |
| `nginx_basic` | nginx（`auth_basic`） | nginx 自身が付ける |
| `nginx_deny` | nginx（`deny`） | 403 |

## なぜ剥がすアームを置くか

「401 を返すとブラウザのログインダイアログが出てしまう」への回避策として、英語圏では `WWW-Authenticate` を消す手が紹介されています。消した結果、**401 のまま仕様違反の応答になる**のかどうかを、同じ計測で並べて確かめます。

## 判定

curl で 1 回ずつ叩き、応答コードと `WWW-Authenticate` の有無を記録します。判定に使うのはこの 2 つだけで、本文の中身は見ません。

## 記事のどこに出るか

実効値の表「401 に添える WWW-Authenticate」。決定表の「401 を選んだとき、何を添えるか」の裏づけ。

## 実行

```bash
bash scenarios/004-auth-challenge/run.sh
```
