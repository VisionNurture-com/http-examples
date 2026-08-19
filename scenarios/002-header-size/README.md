# 002-header-size — 大きすぎるヘッダは、どこで弾かれるか

## 何を測るか

ヘッダを「削る」前に、**多すぎて弾かれる**側を測ります。同じリクエストでも、上限を持っているのが nginx なのか、その先のアプリなのかで返る応答が変わります。

| 軸 | 内容 |
|---|---|
| A | **1 本のヘッダ行が長い**（値を 4,096〜20,000 バイトで振る）|
| B | **本数が多い**（1 本 1,000 バイトを 4〜40 本）|
| C | 400 のエラーページが `User-Agent` で伸びるか |
| D | 8k / 16 KiB の 1 バイト前後 |
| E | Express 直結の 431 境界を二分探索 |

## なぜ 4 経路か

「大きすぎ」を弾く主体を分けるためです。

| 経路 | 入口 | 上限 |
|---|---|---|
| nginx 単独（静的） | `/002/static/sample.html`（8087） | `large_client_header_buffers` 既定 `4 8k` |
| nginx→Express | `/002/api/echo`（8087） | nginx が先・その先に Node の 16 KiB |
| Express 直結 | `/002/api/echo`（8086） | Node の `--max-http-header-size` 既定 16 KiB |
| **対照（上限を上げた server）** | `Host: headersize.test` で 8087 | `large_client_header_buffers 8 32k` |

### 対照はポートを足さずに作る

`large_client_header_buffers` は `http` / `server` コンテキスト専用で `location` に書けません。上限を変えた対照には server ブロックがもう 1 つ要ります。

そこで **`listen 87` はそのままに `server_name` だけを分けました**（`localhost` ⟷ `headersize.test`）。同じポート × **別の** `server_name` は nginx が `Host` を見て振り分ける正規の使い方です。

> 過去に「同じポート × **同じ** `server_name`」を作ってしまい、後勝ちで一方が `ignored` になり、別記事のシナリオを黙って壊しました。新しい入口を足すときは `nginx -t` の警告を必ず読みます。

## 判定

- 応答コードだけでは「nginx が弾いた」と「アプリが弾いた」を分けられません。`nginx→Express` の経路では、**echo の本文に自分が送ったヘッダが写っているか**で到達を判定します
- 既定値は測る前に公式ドキュメントで確定しました（nginx `4 8k` / Node 16 KiB）
