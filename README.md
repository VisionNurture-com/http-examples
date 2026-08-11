# http-examples

HTTP の通説を実機で確かめるための伴走サンプルです。記事に載せる数値は、すべてこのリポジトリで測ったログに裏づけられています。

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

停止します。

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

## M3 — VM で測る

`vm/README.md` を参照してください。

## ディレクトリ

```
nginx/conf.d/   ★ 記事に載せる設定の正本。記事側はここから引用する
minimal/        記事 008 sec07 の最小構成（compose なしで 2 オリジンを立てる）
app/            Express 5 バックエンド（既定の挙動そのものが観測対象）
scenarios/      シナリオ 1 つ = 実効値カード 1 枚。run.sh と expected.md を持つ
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

### 観測チャネルが死ぬ経路（008 系）

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
