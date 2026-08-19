# http-examples

HTTP の通説を実機で確かめるためのサンプル集です。記事に載せる数値は、すべてこのリポジトリで測ったログに裏づけられています。

## 4 つの実行モード

測るものによって必要な環境が変わります。

| モード | 必要なもの | 測れるもの | CI |
|---|---|---|:--:|
| **M0** | Node 24 以上のみ（**docker 不要・ネットワーク不要**） | 構成の整合・記事の値と実測ログの突合 | ✅ |
| **M1** | Docker Compose | プロトコル挙動・ヘッダ・サーバ側設定の実効値 | ✅ |
| **M2** | M1 + ホストの実ブラウザ | ブラウザ固有のクランプ・キャッシュ・セキュリティ挙動 | ❌ 手動 |
| **M3** | Multipass VM（Ubuntu） | 回線条件を振った測定・カーネル統計・HTTP/3 の交差点 | ❌ 手動 |

## M0 — まずこれだけで動きます

<!-- repro:setup -->
```bash
npm ci
npm run check:structure
npm run check:provenance
```

`check:provenance` は、記事に載せる値（`scenarios/<id>/expected.md`）と実測ログ（`results/<id>/summary.json`）、および設定の正本（`nginx/conf.d/*.conf`）を突き合わせます。**食い違えば落ちます。**docker もネットワークも使わないため、clone した直後から動きます。

記事の数値がどこから来たかを自分で確かめたいときは、これを実行してください。

## M1 — Compose で測る

<!-- repro:up -->
```bash
bash tools/gen-certs.sh          # 証明書を用意する
docker compose up -d --wait
bash scenarios/000-smoke/run.sh  # 土台の確認
```

測り終えたら停止します。

<!-- repro:down -->
```bash
docker compose down -v
```

### 証明書について

`tools/gen-certs.sh` は `mkcert` があればそれを使い、無ければ `openssl` の自己署名へ落とします。

`curl -k` で足りる M1 は自己署名で問題ありません。ブラウザを使う M2 では警告が出ます。とくに **HSTS は証明書エラーをバイパスした接続には適用されない**ため、HSTS を扱うシナリオは `mkcert` の導入が要ります。

```bash
brew install mkcert   # macOS
```

生成した証明書は `certs/` に置かれ、リポジトリには含めません。

## 002 — ヘッダを削って測る

記事 002（HTTP ヘッダ）が使うシナリオは 9 本です。記事に載せた値だけを確かめたいなら、docker を立てずにこれだけで足ります。

```bash
npm ci
npm run check:provenance -- --prefix 002
```

| シナリオ | 測るもの | モード |
|---|---|:--:|
| `002-minimize` | ブラウザが送った集合を 1 本ずつ落とし、応答が変わる点を探す。最後にまとめて落として検算する | M2 |
| `002-host` | `Host` を落として 3 経路へ送る。削ると壊れるのはこの 1 本だけか | M1 |
| `002-length` | `Content-Length` を落としたときに、本文がサーバへ何バイト届くか | M1 |
| `002-accept-encoding` | `Accept-Encoding` を落としたときの転送量。応答コードは変わらない側 | M1 |
| `002-duplicate-order` | ヘッダの並び順と、同じ名前を 2 本送ったときの扱い | M1 |
| `002-header-size` | 1 本を長くする場合と本数を増やす場合で、どこが弾くか（400 と 431 の境界）| M1 |
| `002-expect` | curl が `Expect: 100-continue` を自分で足し始める本文の大きさ | M1 |
| `002-conn-h2` | HTTP/2 で接続固有ヘッダを送ったとき、実際にワイヤへ流れるか | M1 |
| `002-upgrade` | `Upgrade` が中継を越えるか。経路を 1 段減らすと結果が変わるか | M1 |

`002-minimize` だけは実ブラウザからの採取（`node tools/capture-002-browser.mjs`）が先に必要なため CI では回りません。採取結果を置いたあとは `run.sh` だけで再現できます。

## minimal/ — 記事 008 sec07 の最小構成

記事 008（CORS）の sec07 は、ページ側と API 側の 2 つのオリジンを手元に立てる手順を扱います。そこで使う設定 1 本とページ 1 枚を `minimal/` に置いてあります。**記事から写しても、ここから使っても同じもの**です（`check:provenance` が記事に載せた断片と突合します）。

```bash
docker run --rm -p 8080:80 -p 8081:81 \
  -v "$PWD/minimal/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$PWD/minimal/public:/usr/share/nginx/html:ro" \
  nginx:1.31.3-alpine
```

到着記録は `/dev/stdout` に出るため、起動した画面にそのまま流れます。停止は `Ctrl` + `C` です。

`minimal/` は **M1 の compose とポートが衝突する**ので、同時には起動できません。compose を立てずに sec07 だけを試したいときに使います。扱えるのは preflight の発生条件と `Access-Control-Max-Age` の 2 つで、リダイレクトと `Authorization` の測定（第 3 のオリジンが要るもの）は M1 の compose 側にあります。

## 012/ — 圧縮辞書と Early Hints を測る

記事 012（TTFB）が使うシナリオは 10 本です。記事に載せた値だけを確かめたいなら、docker を立てずにこれだけで足ります。

```bash
npm ci
npm run check:provenance -- --prefix 012
```

| シナリオ | 測るもの |
|---|---|
| `012-dictionary` | 圧縮辞書（RFC 9842）を追加モジュールなしの nginx で配れるか。4 エンジンで対応状況も見ます |
| `012-crossover` | 書き換え率を 0〜100% で 10 段に振り、辞書ありが辞書なしに追い抜かれる地点 |
| `012-breakeven` | 辞書を配る費用がいつ回収できるか（既存資源を辞書にする場合と、専用の辞書を配る場合）|
| `012-compression-tradeoff` | 種別ごとの圧縮率・圧縮が得になる最小の大きさ・水準を上げたときの費用 |
| `012-brotli-types` | `brotli_types` に重複を書いたときの警告と、その重大度 |
| `012-vary` | `Vary` を落としたときに共有キャッシュが次の利用者へ何を配るか |
| `012-early-hints` | 103 を送ったときに報告 TTFB とサーバの処理時間がそれぞれどう動くか |
| `012-early-hints-enabled` | nginx に `early_hints` を書くと 103 が届くようになるか。何が変わって何が変わらないか |
| `012-timing-api` | 最終ヘッダの時刻を取る属性が、どのエンジンに実在するか |
| `012-lighthouse-ttfb` | Lighthouse の「サーバ応答時間」が 103 の有無でどう変わるか |

素材は `public/012/` の 2 つのフィクスチャです。**編集しないでください**（理由は [`public/012/README.md`](public/012/README.md)）。

### 実ブラウザで試すときの注意（M2）

圧縮辞書は、**公的に信頼された認証局からたどれないサイトでは Chromium 系が使いません**。`mkcert` などで手元に作った認証局のホスト名で開くと、辞書は登録されヘッダも届いているのに、要求に `dcb, dcz` が付きません。しかも警告は何も出ません。

`localhost` は出どころとして特別扱いされるため、そちらでは同じ設定が効きます。効かないときは、ブラウザ側ではなく `results/012-dictionary/access.log` で要求の `Accept-Encoding` を見てください。

### 103 を確かめる経路

既定の設定の nginx は、上流から受け取った 103 をクライアントへ渡しません（[`early_hints`](https://nginx.org/en/docs/http/ngx_http_core_module.html) を書かない限り止まります）。そのため 103 の測定には、nginx を通さない口を 2 つ開けてあります。下の表は、その 2 つと、012 で使う nginx 側の口を並べたものです。

| ポート | 中身 | nginx |
|---|---|:--:|
| `8086` | アプリへ直結（HTTP/1.1）| 通さない |
| `8447` | HTTP/2 + TLS で 103 を出す対照サーバ | 通さない |
| `8445` | 012 専用の入口（辞書の配信・どのエンジンからでも測れます）| 通す |
| `8448` | 共有キャッシュを前段に置いた `Vary` の再現用 | 通す |

## M3 — VM で測る

`vm/README.md` を参照してください。

## ディレクトリ

```
nginx/conf.d/   ★ 記事に載せる設定の正本。記事側はここから引用する
minimal/        記事 008 sec07 の最小構成（compose なしで 2 オリジンを立てる）
app/            Express 5 バックエンド（既定の挙動そのものが観測対象）
scenarios/      シナリオ 1 つ = 実効値の表 1 枚。run.sh と expected.md を持つ
results/        実測ログ。run.log（生ログ）と summary.json（実効値）
tools/          M0 の検証スクリプト（Node のみ）
vm/             M3 の手順と netem スクリプト
```

## 数値の出どころ

<!-- repro:map -->
```
run.sh 実行
   ↓
results/<id>/run.log        生ログ（人が読む）
   ↓ 抽出
results/<id>/summary.json   実効値（機械が読む）
   ↓ 突合（npm run check:provenance）
scenarios/<id>/expected.md  ★ 記事に載せる値の正本
   ↓ 引用
記事本文
```

CI で回らない M2 / M3 は、`run.log` の先頭に `measured-at:` として測定日時と環境を記録します。`check:provenance` がその有無を検査します。

### ログが書けなくなると測定が嘘になる

008 の測定は、preflight が飛んだかどうかを**サーバ側の到着記録**で判定します。ブラウザから preflight のキャッシュを覗く API がないためです。

このため nginx がログを書けなくなると、測定そのものが嘘になります。nginx は起動時にログを open したまま保持するので、**コンテナを動かしたままホスト側でログファイルを置き換える**（`git checkout` での復元、バックアップからの `cp`、`rm`）と、削除済み inode へ書き続けます。

```
$ docker exec http-examples-edge sh -c 'for p in $(ls /proc | grep -E "^[0-9]+$"); do \
    [ "$(cat /proc/$p/comm 2>/dev/null)" = nginx ] && ls -l /proc/$p/fd; done' | grep deleted
5 -> /results/008-cors-max-age/preflight.log (deleted)
```

この状態で測ると**全ケースが「preflight なし」**になります。実測は 8 ケース中 4 件なのに 0 件と出て、終了コードは 0 のままです。

対策を 2 つ入れてあります。

- **予防**: 各 `scenarios/008-*/run.sh` の先頭で `docker compose exec -T edge nginx -s reopen` を実行します
- **検出**: 測定中にログが 1 行も増えなければ、`tools/log-channel.mjs` が結果を書き出さずに終了コード 1 で落とします（`run.sh` を経由せずツールを直接叩いたときの保険）

手で復旧するときは次を実行してください。

```bash
docker compose exec edge nginx -s reopen
```

## ライセンス

MIT
