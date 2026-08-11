# 008-redirect の期待値

記事に載せる値の正本。`results/008-redirect/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| Chromium | 151.0.7922.34 |
| Firefox | 153.0 |
| WebKit | 26.5（Playwright 同梱。**Safari そのものではない**）|
| ページのオリジン | `http://localhost:8080` |
| API のオリジン | `http://localhost:8081` |
| 第 3 のオリジン | `http://localhost:8083` |
| 測定日 | 2026-08-08 |

## 実測結果

**3 エンジンで判定はすべて一致しました。**

| ケース | 構成 | fetch | API 側の preflight | 備考 |
|---|---|:--:|:--:|---|
| R0 | リダイレクトなし（対照）| 成功 | 1 | — |
| R1 | 単純リクエストが同一オリジン内で 301 | 成功 | 0 | 単純リクエストなので preflight なし |
| **R2** | preflight を伴うリクエストの**本番送信が 301** | 成功 | **2** | **リダイレクト先でもう一度 preflight が飛ぶ** |
| **R3** | **preflight（OPTIONS）自体が 301** | **失敗** | 1 | 301 は ok status ではない |
| **R4** | **別オリジンへリダイレクト** + `Authorization` | **失敗** | 1 | 下記 |

### R4 の内訳

第 3 のオリジンには 3 エンジンとも到達しました（preflight が届いています）。**そこで送られた `Origin` は `null`** でした。サーバが具体的なオリジンを返す設定では、この時点で CORS チェックに通りません。

`Authorization` は、第 3 のオリジンに届いた本番リクエストから**消えていました**。

## 読み取り

**末尾スラッシュの 301 を挟むだけで preflight が倍になります**（R2）。同一オリジン内のリダイレクトでも、リダイレクト先の URL に対して別のエントリが要るためです。

**preflight そのものがリダイレクトされると失敗します**（R3）。プロキシが OPTIONS も一律にリダイレクトする設定だと、CORS は通りません。

**別オリジンへリダイレクトすると `Origin` が `null` になります**（R4）。`Access-Control-Allow-Origin` に具体的な値を書いている限り、リダイレクト先では必ず落ちます。あわせて `Authorization` も消えるため、仮にオリジンの問題を回避しても認証は通りません。

```json
{
  "scenario": "008-redirect",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "case_count": 5,
    "R0_fetch_ok": true,
    "R0_preflight_count": 1,
    "R1_fetch_ok": true,
    "R1_preflight_count": 0,
    "R2_fetch_ok": true,
    "R2_preflight_count": 2,
    "R3_fetch_ok": false,
    "R3_preflight_count": 1,
    "R4_fetch_ok": false,
    "R4_preflight_count": 1,
    "R4_third_origin_reached": true,
    "R4_third_origin_saw_null_origin": true,
    "R4_authorization_survived": false
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/008-cors.conf",
      "must_contain": [
        "location = /008/redirect/preflighted {",
        "location = /008/redirect/optionsredirect {",
        "location = /008/redirect/crossorigin {",
        "return 301 http://localhost:8083/008/redirect/third-target;"
      ]
    }
  ]
}
```
