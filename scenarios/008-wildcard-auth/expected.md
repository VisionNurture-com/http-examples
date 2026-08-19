# 008-wildcard-auth の期待値

記事に載せる値の正本。`results/008-wildcard-auth/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| Chromium | 151.0.7922.34 |
| Firefox | 153.0 |
| WebKit | 26.5（Playwright 同梱。**Safari そのものではない**）|
| 宣言した `Access-Control-Max-Age` | 30 秒 |
| 2 回目を送るまでの間隔 | 3 秒 |
| 使ったトークン | 実在しない合成値（サーバのログには `auth=yes/no` だけを残す）|
| 測定日 | 2026-08-08 |

## 実測結果

| ケース | サーバの `Allow-Headers` | リクエスト | fetch | 2 回目の preflight |
|---|---|---|:--:|---|
| W0 | `authorization, x-probe` | `Authorization` あり | 成功 | 飛ばない（3 エンジン一致）|
| **W1** | **`*`** | `Authorization` あり | **成功** | **Chromium 飛ぶ / Firefox 飛ぶ / WebKit 飛ばない** |
| W2 | `*` | `x-probe` のみ | 成功 | **Chromium 飛ばない / Firefox 飛ぶ / WebKit 飛ばない** |
| W3 | `authorization, x-probe` + `Allow-Credentials` | `Authorization` + credentials: include | 成功 | 飛ばない（3 エンジン一致）|

## 仕様との食い違い

仕様は `*` と `Authorization` の組み合わせを **network error** と定めています。

> If one of request's header list's names is a CORS non-wildcard request-header name and is not a byte-case-insensitive match for an item in headerNames, then return a network error.

**しかし 3 エンジンとも fetch は成功しました**（W1）。この規定に追随しているエンジンは、この測定の範囲にはありません。

分かれたのはキャッシュ側です。仕様は「`*` のエントリは `Authorization` にマッチしない」と定めており、**Chromium と Firefox はこれに沿って毎回 preflight を飛ばします**。WebKit は飛ばしません。

## 読み取り

**`Access-Control-Allow-Headers: *` は、認証付きの API では `Access-Control-Max-Age` を無効にします**（Chromium / Firefox）。`authorization` を明示列挙すれば効きます（W0）。

これは [whatwg/fetch#1278](https://github.com/whatwg/fetch/issues/1278)（2021-08 報告・今も OPEN）の症状そのものです。報告者は「Safari では preflight が見えないので検証できなかった」と書いていますが、**サーバ側の到着記録で見れば WebKit は飛ばしていません**。

W2 で Firefox だけが飛ぶことから、Firefox は `*` のエントリを `Authorization` 以外にも使っていないと読めます。

```json
{
  "scenario": "008-wildcard-auth",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "case_count": 4,
    "W0_fetch_ok": true,
    "W0_second_preflight_fired": false,
    "W1_fetch_ok": true,
    "W1_second_preflight_fired": "browsers_disagree",
    "W1_second_preflight_fired_chromium": true,
    "W1_second_preflight_fired_firefox": true,
    "W1_second_preflight_fired_webkit": false,
    "W2_fetch_ok": true,
    "W2_second_preflight_fired": "browsers_disagree",
    "W2_second_preflight_fired_chromium": false,
    "W2_second_preflight_fired_firefox": true,
    "W2_second_preflight_fired_webkit": false,
    "W3_fetch_ok": true,
    "W3_second_preflight_fired": false
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/008-cors.conf",
      "must_contain": [
        "location ~ ^/008/wildcard/star(/.*)?$",
        "location ~ ^/008/wildcard/explicit(/.*)?$",
        "add_header Access-Control-Allow-Headers \"authorization, x-probe\"       always;"
      ]
    }
  ]
}
```
