# 008-preflight-boundary の期待値

記事に載せる値の正本。`results/008-preflight-boundary/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| Chromium | 151.0.7922.34 |
| Firefox | 153.0 |
| WebKit | 26.5 |
| ページのオリジン | `http://localhost:8080` |
| API のオリジン | `http://localhost:8081` |
| 測定日 | 2026-08-07（Chromium / Firefox）・2026-08-08（WebKit 追加実行） |

**3 エンジンで結果は完全に一致した**（8 ケースすべてで判定が同じ）。

## 実測結果

| リクエスト | preflight |
|---|:--:|
| GET・独自ヘッダなし | 飛ばない |
| GET・独自ヘッダ `x-probe` あり | **飛ぶ** |
| POST・`Content-Type: text/plain` | 飛ばない |
| POST・`Content-Type: application/x-www-form-urlencoded` | 飛ばない |
| POST・`Content-Type: multipart/form-data` | 飛ばない |
| POST・`Content-Type: application/json` | **飛ぶ** |
| PUT・独自ヘッダなし | **飛ぶ** |
| DELETE・独自ヘッダなし | **飛ぶ** |

8 件中 4 件で preflight が発生した。

## 読み取り

`Content-Type` の値ひとつが境界になる。`text/plain` と `application/json` は同じ POST でありながら、後者だけが preflight を伴う。**API を JSON にした時点でリクエスト数が倍**になり、その分が往復のたびに乗る。

メソッドでは GET のみが例外で、PUT と DELETE は独自ヘッダがなくても飛ぶ。

```json
{
  "scenario": "008-preflight-boundary",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "preflighted_count": 4,
    "case_count": 8,
    "all_browsers_agree": true,
    "preflight_get_plain": false,
    "preflight_get_custom_header": true,
    "preflight_post_text_plain": false,
    "preflight_post_form_urlencoded": false,
    "preflight_post_multipart": false,
    "preflight_post_json": true,
    "preflight_put_plain": true,
    "preflight_delete_plain": true
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/008-cors.conf",
      "must_contain": ["location ~ ^/008/boundary(/.*)?$", "Access-Control-Allow-Methods"]
    },
    {
      "path": "minimal/nginx.conf",
      "must_contain": [
        "location ~ ^/008/boundary(/.*)?$",
        "add_header Access-Control-Allow-Methods \"GET, POST, PUT, DELETE, OPTIONS\" always;",
        "access_log /dev/stdout preflight;"
      ]
    }
  ]
}
```
