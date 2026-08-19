# 008-cache-key — preflight キャッシュの鍵の粒度

## 何を測るか

`Access-Control-Max-Age` を書いたのに preflight が毎回飛ぶのはなぜか。仕様（WHATWG Fetch / CORS-preflight cache）はエントリの鍵を次のように定めています。

> key（network partition key）/ byte-serialized origin / **URL** / max-age / **credentials** / **method** / **header name**

さらにエントリは「**レスポンスの `Access-Control-Allow-Methods` / `-Headers` に列挙された分**」だけ作られます。リクエストが要求した分ではありません。そこでサーバの応答を 2 系統に分けて測ります。

| 系統 | 応答 |
|---|---|
| `fixed` | 要求に関係なく広く列挙する |
| `echo` | 要求されたものだけを返す |

## 記事のどこに出るか

実効値の表「preflight キャッシュはどこで別物になるか」の**実効値**欄。

## 判定

サーバ側の OPTIONS 到着記録（`results/008-cache-key/preflight.log`）。1 ケースにつき 1 回目 → 3 秒後 → 2 回目 を同一コンテキストで送り、2 回目に OPTIONS が届けば別エントリ扱いです。`max-age` は 30 秒なので、3 秒後の再発は期限切れではありません。

判定は生ログのカウントのみで機械的に行い、**予測と食い違ってもそのまま記録します**。
