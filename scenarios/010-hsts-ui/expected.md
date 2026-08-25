# 010-hsts-ui の期待値

記事に載せる値の正本。`results/010-hsts-ui/summary.json` と突合される。

## 測る対象

`chrome://net-internals/#hsts` の **Delete** が、登録経路によって効いたり効かなかったり
するかを測る。判定は画面の `Not found` 表示ではなく、**Query が返すフィールド**で行う。

| フィールド | 意味 |
|---|---|
| `static_sts_domain` | **preload 由来**（ブラウザに焼き込まれている）|
| `dynamic_sts_domain` | **ヘッダ由来**（そのプロファイルが覚えている）|

## 実測結果（実 Chrome）

| ケース | 対象 | 由来 | 削除前 | 削除後 | 判定 |
|---|---|---|---|---|---|
| **K2** | `example.test` | dynamic | `dynamic_sts_domain: example.test` / **https昇格** | **空** / **http到達** | ✅ **効く** |
| **K5** | `github.com` | **static** | `static_sts_domain: github.com` / `FORCE_HTTPS` | 🔴 **同じ**（`github.com` / `FORCE_HTTPS`）| ❌ **効かない** |

🔴 **同じ画面の同じ Delete ボタンで、消えるものと消えないものがある。**preload されたドメインは
UI から削除できない。`.dev` ドメインでローカル開発が壊れた 2017 年の事例はこの型である。

> preload リストからの削除は Google への申請が要り、**ユーザーに届くまで 6〜12 週**かかる
> （hstspreload.org: "a preload list domain removal may take 6-12 weeks to reach most Chrome
> users, and may take longer for other browsers"）。

## 使ったセレクタ

| 用途 | セレクタ |
|---|---|
| Query | `#hsts-view-query-input` + `#hsts-view-query-submit` |
| **Delete** | `#domain-security-policy-view-delete-input` + `#domain-security-policy-view-delete-submit` |
| 出力 | `#hsts-view-query-output` |

🔴 Delete は `hsts-view-` 接頭辞ではない。名前から推測すると空振りする。

```json
{
  "scenario": "010-hsts-ui",
  "mode": "M2",
  "values": {
    "k2_dynamic_before": "example.test",
    "k2_dynamic_after": "",
    "k2_http_before": "https昇格",
    "k2_http_after": "http到達",
    "k2_ui_delete_effective": true,
    "k5_static_before": "github.com",
    "k5_static_after": "github.com",
    "k5_mode_before": "FORCE_HTTPS",
    "k5_mode_after": "FORCE_HTTPS",
    "k5_ui_delete_effective": false
  },
  "config_refs": [
    { "path": "nginx/conf.d/010-hsts.conf", "must_contain": ["max-age=600", "plain-http"] },
    { "path": "tools/measure-010-ui.mjs",
      "must_contain": ["#domain-security-policy-view-delete-input", "#hsts-view-query-output"] }
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

- **Chromium 系だけを測った。**Gecko / WebKit は削除の UI も保存場所も別機構
  （Firefox = プロファイルの状態ファイル / Safari = OS 側の保存）で、**未測定**。
- **`github.com` は所有していない。**Query で状態を読み、Delete が効かないことを確認しただけで、
  同ドメインへ通信はしていない。
- **preload への提出は行っていない。**外部サービスへの不可逆な操作であり、取り消しに 6〜12 週かかる。
  取り消しコストは一次情報の引用であって実測値ではない。
