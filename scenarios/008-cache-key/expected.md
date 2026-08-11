# 008-cache-key の期待値

記事に載せる値の正本。`results/008-cache-key/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| Chromium | 151.0.7922.34 |
| Firefox | 153.0 |
| WebKit | 26.5（Playwright 同梱。**Safari そのものではない**）|
| 宣言した `Access-Control-Max-Age` | 30 秒 |
| 2 回目を送るまでの間隔 | 3 秒（期限切れではないことを保証するため）|
| ページのオリジン | `http://localhost:8080` |
| API のオリジン | `http://localhost:8081` |
| 測定日 | 2026-08-08 |

## 実測結果

**飛んだ = 2 回目も preflight が届いた（別エントリ扱い）**

| 変えたもの | `fixed`（広く列挙）| `echo`（要求分だけ）|
|---|:--:|:--:|
| K0 何も変えない | 飛ばない | 飛ばない |
| K1 パス | 飛んだ | 飛んだ |
| K2 **クエリだけ** | **飛んだ** | **飛んだ** |
| K3 **メソッド**（PUT → DELETE）| **飛ばない** | **飛んだ** |
| K4 **独自ヘッダを増やす** | **飛ばない** | **飛んだ** |
| K5 独自ヘッダを減らす | 飛ばない | 飛ばない |
| K6 credentials なし → include | 飛んだ | 飛んだ |
| K7 credentials include → なし | **エンジンで割れた** | **エンジンで割れた** |

### K7 の内訳（3 エンジンで判定が割れた）

| エンジン | 2 回目 |
|---|---|
| Chromium 151 | 飛ばない |
| **Firefox 153** | **飛んだ** |
| WebKit 26.5 | 飛ばない |

仕様は「エントリの credentials が true なら、credentials を使わないリクエストにも当たる」と定めており、Chromium と WebKit はこれに沿っています。Firefox はこの 2 系統・2 回の実行でいずれも飛びました。

## 読み取り

**`Access-Control-Allow-Methods` / `-Headers` に広く列挙しておくと preflight が減ります。**K3 と K4 が `fixed` と `echo` で真逆になるのがその証拠です。仕様がエントリを「**レスポンスに列挙された分**」だけ作るため、要求されたものだけを返す実装では、メソッドやヘッダが 1 つ変わるたびに preflight が飛びます。

**クエリ文字列が違えば別のキャッシュです**（K2）。パラメータを付け替えて呼ぶ API では、`max-age` を長くしても preflight は減りません。

**ヘッダは増やすと飛び、減らすと飛びません**（K4 / K5）。エントリはヘッダ名ごとに作られるため、既に作られた集合の部分集合なら当たります。

```json
{
  "scenario": "008-cache-key",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "case_count": 8,
    "fixed_K0_second_fired": false,
    "fixed_K1_second_fired": true,
    "fixed_K2_second_fired": true,
    "fixed_K3_second_fired": false,
    "fixed_K4_second_fired": false,
    "fixed_K5_second_fired": false,
    "fixed_K6_second_fired": true,
    "fixed_K7_second_fired": "browsers_disagree",
    "fixed_K7_second_fired_chromium": false,
    "fixed_K7_second_fired_firefox": true,
    "fixed_K7_second_fired_webkit": false,
    "echo_K0_second_fired": false,
    "echo_K1_second_fired": true,
    "echo_K2_second_fired": true,
    "echo_K3_second_fired": true,
    "echo_K4_second_fired": true,
    "echo_K5_second_fired": false,
    "echo_K6_second_fired": true,
    "echo_K7_second_fired": "browsers_disagree"
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/008-cors.conf",
      "must_contain": [
        "location ~ ^/008/cachekey/fixed(/.*)?$",
        "location ~ ^/008/cachekey/echo(/.*)?$",
        "add_header Access-Control-Allow-Methods     $http_access_control_request_method"
      ]
    }
  ]
}
```
