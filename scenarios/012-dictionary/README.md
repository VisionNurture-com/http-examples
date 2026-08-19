# 012-dictionary — 圧縮辞書（RFC 9842）は素の nginx で配れるか

## 何を測るか

RFC 9842（Compression Dictionary Transport）は、**すでに配ってあるファイルを辞書にして次の版を差分で送る**仕組みです。nginx にこの機能のモジュールはありません。そこで「差分を事前に作っておき、条件が揃ったときだけ差し替える」形で配れるかを測ります。サーバは圧縮しません。

素材は同じアプリの 2 つの版です（出自は [`../../public/012/README.md`](../../public/012/README.md)）。

| 役割 | ファイル | バイト |
|---|---|---:|
| 辞書（配布済みの版）| `public/012/bundle-v1.js` | 99,465 |
| 対象（次のデプロイ）| `public/012/bundle-v2.js` | 100,814 |

## 記事のどこに出るか

決定表の「圧縮方式」列と、「その改善は本物か」の判定材料。

## 判定

**2 系統で取ります。** ブラウザ側の要求ヘッダと、nginx の到着記録（`results/012-dictionary/access.log`）です。片方だけでは「辞書を送ったが一致しなかった」と「そもそも送っていない」を分けられません。

- 応答に `Use-As-Dictionary` が付いたか
- 次の版の要求に `Available-Dictionary` と `Accept-Encoding: dcb, dcz` が付いたか
- 応答が `Content-Encoding: dcb` で返り、`decodedBodySize` が元の大きさへ戻るか

## 手元の CA では黙って無効になる

Chrome は**公的に信頼されたルートから辿れる証明書でないと辞書を使いません**（`CompressionDictionaryTransportRequireKnownRootCert`）。`localhost` は出自として特別扱いされるため素通りしますが、mkcert の CA を本番同様のホスト名で使うと、

- 辞書は登録される（`chrome://net-internals/#sharedDictionary` に出る）
- `Use-As-Dictionary` も届いている
- DevTools の Issues には何も出ない

にもかかわらず、要求に `dcb, dcz` が付きません。本シナリオはこの差を切り分けアームとして測ります。

## 前提

```bash
bash tools/gen-certs.sh
docker compose up -d --wait
node tools/make-012-artifacts.mjs
```

`brotli` と `zstd` の CLI が要ります（辞書付きの圧縮は node:zlib では作れません）。

## 実行

```bash
bash scenarios/012-dictionary/run.sh
```
