# 004-proxy-cache — キャッシュはコードを見ているか

## 何を測るか

RFC 6585 §4 は 429 について `Responses with the 429 status code MUST NOT be stored by a cache.` と定めています。前段の nginx がこれを実装しているかを、2 通りの設定で測ります。

| アーム | 設定 | 保存の判断を誰がするか |
|---|---|---|
| 命じる側 | `proxy_cache_valid any 60s;` | こちら（設定） |
| 委ねる側 | `proxy_cache_valid` を書かない | 応答の `Cache-Control` |

## なぜ 2 通りか

🔴 命じる側だけを測ると、**測れたのは設定であって nginx の判断ではありません**。「429 だから保存しない」という規定を実装が持っているかは、保存の可否を応答側に委ねたときにしか分かりません。

## 判定

同じ URL を 2 回叩き、2 回目の `X-Cache-Status` を見ます。`HIT` なら保存されています。

## 記事のどこに出るか

実効値の表「前段はコードで何を変えるか」。「汎用 HTTP ソフトはコードで何を変えるか」の裏づけ。

## 実行

```bash
bash scenarios/004-proxy-cache/run.sh
```
