# 008-cors-max-age の期待値

記事に載せる値の正本。`results/008-cors-max-age/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| Chromium | 151.0.7922.34 |
| Firefox | 153.0 |
| WebKit | 26.5（Playwright 同梱。**Safari そのものではない**）|
| ページのオリジン | `http://localhost:8080` |
| API のオリジン | `http://localhost:8081` |
| 上限測定の長さ | 7,500 秒（プローブ各 250 回・失敗 0）|
| プローブ間隔 | 上限測定は 30 秒 / 既定と 2 秒の測定は 1 秒 |
| 測定日 | 2026-08-07（Chromium / Firefox）・2026-08-08（WebKit）|

## 実測結果

| サーバの宣言 | Chromium 151 | Firefox 153 | WebKit 26.5 |
|---|---|---|---|
| ヘッダなし | **5 秒**ごとに再 preflight | **5 秒**ごとに再 preflight | **5 秒**ごとに再 preflight |
| `Access-Control-Max-Age: 2` | **2 秒**ごと | **2 秒**ごと | **2 秒**ごと |
| `Access-Control-Max-Age: 86400` | **7,202 秒後に再 preflight**（1 回）| **7,500 秒の測定中に再発なし** | **約 600 秒ごとに再 preflight（12 回）** |

WebKit の再発間隔（秒）は 12 回すべてが 600 台でした: `601, 600, 600, 600, 601, 600, 600, 601, 600, 600, 600, 601`

## 読み取り

**同じ `86400` という 1 つの宣言が、3 つのエンジンで 3 通りに解釈されます。**Firefox は 2 時間経っても飛ばさず、Chromium は約 2 時間で、WebKit は**約 10 分**で切れます。

**最も短いのは WebKit です。**`86400` と書いても 10 分しか保ちません。3 エンジンで共通して守られる上限を採るなら **600 秒**が事実上の天井になります。

宣言しないときの既定 5 秒と、小さい値（2 秒）の扱いは 3 エンジンとも一致します。**食い違うのは上限だけ**です。

### 🔴 WebKit の値に一次情報が存在しない

MDN は英語版・日本語版とも Chromium と Firefox の上限しか書いておらず、**Safari / WebKit への言及がありません**（2026-08-08 に両版で確認）。[Cache your CORS](https://httptoolkit.com/blog/cache-your-cors/) も同じ 2 つだけです。検索で出てくる「Safari は 600 秒」は集約サイト由来で、同じ文の中で「Chrome と同じ」と書いており内容が破綻しています（Chrome は v76 以降 7,200 秒）。

仕様は上限の存在だけを認め、値は実装に委ねています。

> If max-age is greater than an imposed limit on max-age, then set max-age to the imposed limit.

### 測定の限界（記事にそのまま書くこと）

- **7,202 秒はプローブ間隔 30 秒による観測遅れを含みます。**キャッシュ切れそのものは 7,200 秒と読めますが、測定値としては 7,202 秒です
- **WebKit の 600 秒も同じ理由で幅を持ちます。**30 秒間隔で観測しているため、真の上限は 571〜600 秒の範囲にあります。12 回の再発がすべて 600 秒台に揃ったことから 600 秒（10 分）と読めますが、**測定値は 600〜601 秒**です
- **Firefox の上限は測っていません。**7,500 秒を超えることだけが実測で言えます。仕様上の 86,400 秒を確かめるには 24 時間の連続測定が要るため実施していません
- **測ったのは Chromium 151 / Firefox 153 / WebKit 26.5 の各 1 点です。**「Chromium v76 以降すべて」のような版の範囲は実測していません
- **WebKit は Playwright 同梱のもので、Safari そのものではありません**

```json
{
  "scenario": "008-cors-max-age",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "default_chromium_gap_median_s": 5,
    "default_firefox_gap_median_s": 5,
    "default_webkit_gap_median_s": 5,
    "maxage_2_chromium_gap_median_s": 2,
    "maxage_2_firefox_gap_median_s": 2,
    "maxage_2_webkit_gap_median_s": 2,
    "clamp_chromium_preflight_count": 2,
    "clamp_chromium_gap_median_s": 7202,
    "clamp_firefox_preflight_count": 1,
    "clamp_firefox_gap_median_s": null,
    "clamp_webkit_preflight_count": 13,
    "clamp_webkit_gap_median_s": 600,
    "webkit_pre_60_webkit_gap_median_s": 60
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/008-cors.conf",
      "must_contain": ["Access-Control-Max-Age", "location ~ ^/008/maxage-(?<ma>\\d+)(/.*)?$"]
    },
    {
      "path": "minimal/nginx.conf",
      "must_contain": [
        "location ~ ^/008/maxage-(?<ma>\\d+)(/.*)?$",
        "add_header Access-Control-Max-Age       $ma                     always;",
        "log_format preflight '$time_iso8601 $request_method $uri max_age=$sent_http_access_control_max_age';"
      ]
    }
  ]
}
```
