# 004-cache-varnish — 実装が変われば答えも変わるのか

## 何を測るか

[`004-proxy-cache`](../004-proxy-cache/README.md) で分かったのは「**nginx は** 429 も保存する」ことでした。1 実装だけでは「キャッシュはコードを見ない」とまでは言えません。ここでは **Varnish** を並べます。

条件は揃えます。**どちらも保存の可否を応答の `Cache-Control` に委ねる**設定にし、同じ 14 コードを 2 回ずつ叩いて 2 回目が保存から返るかを見ます。

| 前段 | 設定 |
|---|---|
| nginx | `/004/cached-cc/`（`proxy_cache_valid` を書かない） |
| Varnish | 既定 VCL（[`varnish/default.vcl`](../../varnish/default.vcl) は `X-Cache` を足すだけ） |

## 判定

2 回目の `X-Cache`（Varnish）/ `X-Cache-Status`（nginx）が `HIT` かどうか。

## 記事のどこに出るか

実効値の表「前段はコードで何を変えるか」。「汎用 HTTP ソフトはコードを見ているか」の答えが**実装で割れる**ことの裏づけ。

## 実行

```bash
bash scenarios/004-cache-varnish/run.sh
```
