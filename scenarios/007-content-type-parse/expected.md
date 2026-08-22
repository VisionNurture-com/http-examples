# 007-content-type-parse — 記事に載せる値

> この表の値は `results/007-content-type-parse/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "007-content-type-parse",
  "mode": "M1",
  "values": {
    "C4_status": 200,
    "C4_body_parsed": false,
    "C5_status": 200,
    "C5_body_parsed": false,
    "C6_status": 200,
    "C6_body_parsed": false,
    "C7_status": 200,
    "C7_body_parsed": false,
    "C8_status": 400,
    "C9_status": 415,
    "C10_status": 415,
    "strict_C5_status": 415,
    "strict_415_accept_header": "application/json",
    "mismatch_cases_total": 4,
    "mismatch_cases_returning_415": 0,
    "C5_nginx_equals_direct": true,
    "C5_content_type_seen": "text/plain",
    "C7_content_type_seen": null,
    "C1_body_type": "object",
    "C4_body_type": "undefined",
    "C5_body_type": "undefined",
    "C6_body_type": "undefined",
    "C7_body_type": "undefined",
    "naive_C1_status": 200,
    "naive_C5_status": 500,
    "naive_C5_error": "TypeError",
    "missing_path_status": 404,
    "missing_path_content_type": "text/html; charset=utf-8",
    "asset_js_content_type": "text/javascript; charset=utf-8"
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/000-base.conf",
      "must_contain": ["proxy_pass http://app_upstream;"]
    }
  ]
}
```

## 読み方

**型が合わなくても、誰も止めません。**

| 送った Content-Type | ステータス | `req.body` |
|---|:--:|:--:|
| `application/vnd.api+json` | **200** | 空 |
| `text/plain` | **200** | 空 |
| `application/x-www-form-urlencoded` | **200** | 空 |
| （ヘッダなし） | **200** | 空 |

型の不一致 **4 ケースで 415 は 1 件も出ません**。ボディが読めなかったことは、応答からは分かりません。

**415 は存在します。ただし別の理由で出ます。**

| 状況 | ステータス |
|---|:--:|
| 未知の `Content-Encoding: foo` | **415** |
| 未対応の `charset=shift_jis` | **415** |
| 型は正しいが壊れた JSON | 400 |

nginx は**素通しです**。10 ケースすべてで nginx 経由と Express 直結の結果が一致し、`bogus/type` のような値も書き換えずにそのまま渡します。

受信側で自分で検査を書けば 415 は返せます（`/007/echo-strict`）。RFC 9110 §15.5.16 は、そのとき `Accept` で受理できる型を示せると述べています——実測でも `Accept: application/json` が返りました。

**空の実体は `{}` ではなく「未定義」です。**

`express@5.2.1` は型が合わないと `req.body` を**設定しません**。4 系が最低でも `{}` を保証していたのとは違います（[expressjs/express#6432](https://github.com/expressjs/express/issues/6432)）。

| 送った Content-Type | `typeof req.body` |
|---|:--:|
| `application/json` | `object` |
| `application/vnd.api+json` | **`undefined`** |
| `text/plain` | **`undefined`** |
| `application/x-www-form-urlencoded` | **`undefined`** |
| （ヘッダなし） | **`undefined`** |

**この差は読者のコードで数字になって出ます。**`req.body.name` と素直に書いた対照（`/007/echo-naive`）では、型が合っていれば 200、合っていなければ **500（`TypeError`）**でした。「200 のまま静かに空になる」のは、受け口が `req.body ?? null` のように防御的に書かれている場合の話です。

| 受け口の書き方 | `application/json` | `text/plain` |
|---|:--:|:--:|
| `req.body ?? null`（`/007/echo`）| 200 | 200（本文は空）|
| `req.body.name`（`/007/echo-naive`）| 200 | **500 TypeError** |

**配る型が `text/html` になる代表原因は、そのパスが実在しないことです。**

存在しない `.js` を要求すると、サーバは HTML のエラーページを返します。ブラウザから見れば「JavaScript を頼んだのに `text/html` が返ってきた」状態で、コンソールの型の不一致メッセージはここから出ます。

| 要求したもの | ステータス | 返った `Content-Type` |
|---|:--:|---|
| `/007/does-not-exist.js`（実在しない）| **404** | **`text/html; charset=utf-8`** |
| `/007/asset?kind=js&ct=text/javascript`（対照）| 200 | `text/javascript; charset=utf-8` |

`curl -I <その URL>` で 1 行見れば切り分けられます。

> 🔴 **C7「ヘッダを付けない」の測り方を 2026-08-22 に是正しました。**Node の `fetch` は文字列ボディへ `Content-Type: text/plain;charset=UTF-8` を自動で足すため、それまでの C7 は実質 C5 の重複でした。`node:http` の生リクエストへ切り替え、到着した型（`C7_content_type_seen: null`）も突合対象に加えています。**結果の値は変わりません**でしたが、出どころが記事の記述と一致していませんでした。
