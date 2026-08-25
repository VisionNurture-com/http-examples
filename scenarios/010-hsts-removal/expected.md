# 010-hsts-removal の期待値

記事に載せる値の正本。`results/010-hsts-removal/summary.json` と突合される。

## 測る対象

サーバではなく **ブラウザが覚えている状態** を測る。判定は画面の文言ではなく
**どのサーバが答えたか**で行う。

| 本文 | 意味 |
|---|---|
| `plain-http` | 平文 HTTP（:94）に到達した → HSTS は効いていない |
| `parent-*` / `child-quiet` | HTTPS（:449）に上がった → HSTS が効いている |

## 実測結果（3 エンジン一致）

| ケース | 手順 | 結果 |
|---|---|---|
| **K0** 対照 | 登録なしで `http://example.test/` | **http到達** |
| **K1** | STS 登録 → http | **https昇格** |
| | → `max-age=0` → http | **http到達**（解ける）|
| **K3** | 子（登録前）| **http到達** |
| | 親に `includeSubDomains` → 子 | **https昇格**（親の指定が子に及ぶ）|
| | 親を `max-age=0; includeSubDomains` → 子 | **http到達**（子も解ける）|
| **K6** | 解除直後 | **http到達** |
| | **HTTPS で再訪してから http** | 🔴 **https昇格**（その場で再登録される）|

**Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5 の 3 エンジンで全ケース一致。**

> 🔴 **K6 が読者の「解除したのにまた戻る」の正体**である。解除しても、その後に一度でも
> HTTPS でそのホストへ行けば、サーバがまだ STS を送っているかぎり即座に登録し直される。

```json
{
  "scenario": "010-hsts-removal",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "cases_total": 4,
    "engines_agree": true,
    "engine_versions": { "chromium": "151.0.7922.34", "firefox": "153.0", "webkit": "26.5" },
    "k0_no_registration": "http到達",
    "k1_after_register": "https昇格",
    "k1_after_maxage0": "http到達",
    "k3_child_before": "http到達",
    "k3_child_after_subs": "https昇格",
    "k3_child_after_off": "http到達",
    "k6_after_off": "http到達",
    "k6_after_revisit": "https昇格"
  },
  "config_refs": [
    { "path": "nginx/conf.d/010-hsts.conf",
      "must_contain": ["max-age=600", "max-age=600; includeSubDomains", "max-age=0", "plain-http"] },
    { "path": "tools/hsts-proxy.mjs", "must_contain": ["PORT_MAP", "8449"] }
  ]
}
```

## 記事に載せる値（設定値・仕様値・実効値の対比）

### ① HSTS の解除手段が効く範囲

| 欄 | 内容 |
|---|---|
| **項目** | HSTS の解除（`Strict-Transport-Security` の取り消し）|
| **設定値** | 通説・国内記事が書く手順 —— `chrome://net-internals/#hsts` の **Delete domain security policies** にドメインを入れて削除する。確認は `Query HSTS/PKP domain` が `Not found` を返すこと |
| **仕様値** | `max-age=0` はホストを Known HSTS Host から外す（RFC 6797 §6.1.1）。`includeSubDomains` も同時に外れる。**保護された接続で受け取って初めて効く**（MDN 日本語版）。HTTP 上の STS ヘッダは無視される（同 §8.1）。preload リストからの削除は **6〜12 週**（hstspreload.org）|
| **実効値** | **登録経路で結果が変わる。**`dynamic`（ヘッダ由来）は UI の Delete で消え、平文 HTTP に到達するようになる。**`static`（preload 由来）は同じ Delete で消えない** —— `static_sts_domain` と `static_upgrade_mode: FORCE_HTTPS` が削除前後で変わらない。測ったのは **実 Chrome 151.0.7922.174**（macOS・一時プロファイル）|
| **出典** | `scenarios/010-hsts-ui/expected.md` |

### ② `includeSubDomains` の効果範囲と、解除の届き方

| 欄 | 内容 |
|---|---|
| **項目** | `includeSubDomains` と `max-age=0` |
| **設定値** | 親ドメインに `max-age=600; includeSubDomains` を付ける。解除は `max-age=0; includeSubDomains` |
| **仕様値** | `includeSubDomains` は当該ホストとその**サブドメインすべて**に及ぶ（RFC 6797 §6.1.2）。`max-age=0` では `includeSubDomains` は効果を持たない（ホストが即座にリストから外れるため・MDN 日本語版）|
| **実効値** | **親の指定は、自分では STS を送っていない子にも及ぶ**（子への平文アクセスが HTTPS へ上がる）。**親を `max-age=0` にすると子も同時に解ける。**🔴 **ただし解除は持続しない** —— 解除後に一度でも HTTPS で親へ行くと、サーバがまだ STS を送っているかぎり**その場で再登録される**。測ったのは **Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5**（Playwright 同梱）で **3 エンジンとも同じ**。⏸ 実 Firefox 154.0 / 実 Safari 26.5.2 では**未測定** |
| **出典** | `scenarios/010-hsts-removal/expected.md` |

> 🔴 **preload の取り消し 6〜12 週は実測値ではありません。**hstspreload.org の記述の引用であり、
> 提出そのものが外部サービスへの不可逆な操作のため行っていません。**仕様値欄**に置いています。

## 測り方の限界

- **同梱ブラウザで測った。**実 Firefox は 154.0 で、同梱の 153.0 は**メジャー 1 つ古い**。
  Playwright は Juggler パッチ入りの独自ビルドを使うため実 Firefox を駆動できない。
  **実 Firefox / 実 Safari での確認は未実施**。
- `max-age` は 600 秒で測った。**期限切れによる自然消滅は測っていない**。
