# 012 のフィクスチャ — 圧縮辞書の測定に使う 2 つの版

圧縮辞書（RFC 9842）の効き方は「配布済みの版と次の版がどれだけ違うか」で決まります。合成データで測ると差分の大きさを自由に作れてしまい、数字が意味を持ちません。そこで**このリポジトリ自身の実在コード**を素材にしています。

## bundle-v1.js（配布済みの版・辞書になる）

`06131b1` 時点の本リポジトリから、次の順にファイルを連結し、**内部向けの符丁だけを一般的な表現へ置換**したものです（置換の理由は下記「内部符丁の置換について」）。

```
app/server.mjs
app/003-methods/routes.mjs
app/004-status/routes.mjs
app/005-idempotency/routes.mjs
app/006-cache/routes.mjs
app/007-content-type/routes.mjs
app/009-auth/routes.mjs
tools/check-structure.mjs
tools/check-provenance.mjs
tools/check-neutrality.mjs
tools/aggregate-006.mjs
tools/aggregate-008.mjs
tools/aggregate-011.mjs
tools/measure-003.mjs
tools/measure-006-cache.mjs
tools/measure-008-cache-key.mjs
```

99,264 バイト。SHA-256（base64）は `fG6CMH4IkZ0KlMuIGGZxW3pNaBRrugvU30I+ppRPaIA=` で、`nginx/conf.d/012-compression.conf` の `$dict_matched` がこの値を見ています。

## bundle-v2.js（次のデプロイ）

v1 に対して、実際のデプロイで起きる程度の変更を加えたものです。

| 変更 | 内容 |
|---|---|
| 先頭のコメント | v1 → v2 |
| ビルド識別子の追加 | `const BUILD_ID = "2026-08-15-b";` を各モジュールの `ROOT` 定義の直後に挿入 |
| 機能追加 1 本 | `app/012-compression/routes.mjs` 相当のルータ（固定ペイロードと、サーバ実処理時間を `Server-Timing` に出す経路）|

100,613 バイト。

## この 2 つはコミットする

圧縮結果はフィクスチャの中身に完全に依存します。リポジトリの `app/` や `tools/` が育つたびに作り直すと、記事に載せた数字が再現できなくなります。**元ファイルは固定してコミットし、圧縮物だけを生成物として扱います**。

```bash
node tools/make-012-artifacts.mjs   # .gz / .br / .zst / .dcb / .dcz を作る
```

## 内部符丁の置換について

この 2 つは、上に挙げた時点のファイルを写した**凍結スナップショット**です。当時のコメントや書きかけの記述も、原則として手を入れずに残してあります。読むためのものではなく、圧縮にかけるためのバイト列として置いてあります。

ただし **1 点だけ例外**があります。スナップショットを取った時点のコメントには、公開リポジトリの外にある作業文書を指す符丁が含まれていました。これらはそれを知らない読者にはコメントとして機能せず、また外部文書の存在を示してしまうため、**一般的な表現へ置換**しました（2026-08-22）。置換は両方の版へ同一の文字列で適用しており、**v1 と v2 の差分の構造は変えていません**（どちらも 112 バイト減）。

## 中身を編集しないでください

1 バイトでも変えると、次のすべてが合わなくなります。

| 変わってしまうもの | 現在の値 |
|---|---|
| 辞書と対象のバイト数 | 99,264 / 100,613 |
| `nginx/conf.d/012-compression.conf` に書いた SHA-256 | `waMBlW5oPJ8orWCX6X3OEk82TM6QsDY3P7oauiTTUqo=` |
| 差分と非差分のバイト数 | `dcb` 577 / `dcz` 592 / `br` 25,917 |
| 書き換え率を 10 段に振った逆転点の表 | `results/012-crossover/summary.json` |
| 辞書の損益分岐 | `results/012-breakeven/summary.json` |

`npm run check:provenance -- --prefix 012` はこれらを突き合わせているため、フィクスチャを触ると落ちます。素材を入れ替えたい場合は、フィクスチャの差し替えと 012 の測定のやり直しを一組で行ってください。
