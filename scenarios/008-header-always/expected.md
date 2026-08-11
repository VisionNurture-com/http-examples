# 008-header-always の期待値

記事に載せる値の正本。`results/008-header-always/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| nginx | 1.31.3（`nginx:1.31.3-alpine`）|
| 測定手段 | `curl`（ブラウザは使わない。**サーバ側の性質のため**）|
| サーバ | `http://localhost:8082`（server レベルで CORS 3 本を宣言）|
| 測定日 | 2026-08-08 |

## 実測結果

**CORS ヘッダ数** = `Access-Control-Allow-Origin` / `-Methods` / `-Headers` のうち応答に含まれた本数。

| ケース | 設定 | 応答コード | CORS ヘッダ数 |
|---|---|:--:|:--:|
| H0 | `always` あり | 200 | **3** |
| H1 | `always` あり | 500 | **3** |
| H2 | `always` なし | 200 | **3** |
| **H3** | **`always` なし** | **500** | **0** |
| **H4** | location に無関係な `add_header` を 1 つ足す | 200 | **0** |
| **H5** | H4 + `add_header_inherit merge;` | 200 | **3** |

## 読み取り

**`always` を付け忘れると、エラー応答からだけ CORS ヘッダが消えます**（H3）。公式ドキュメントは既定の対象を次のように定めています。

> Adds the specified field to a response header provided that the response code equals 200, 201 (1.3.10), 204, 206, 301, 302, 303, 304, 307 (1.1.16, 1.0.13), or 308 (1.13.0).

500 はこの一覧に入っていません。読者から見ると「正常時は通るのに、エラーのときだけ CORS エラーになる」という形で出ます。原因がサーバ側の 1 語にあるため、ブラウザの表示からはたどり着けません。

**location に `add_header` を 1 つ足しただけで、親の CORS 3 本が消えます**（H4）。

> These directives are inherited from the previous configuration level if and only if there are no add_header directives defined on the current level.

`X-Extra` を足したかっただけでも、その location では親の宣言が効かなくなります。**nginx 1.29.3 で追加された `add_header_inherit merge;` を書くと親の値が戻ります**（H5）。

```json
{
  "scenario": "008-header-always",
  "mode": "M1",
  "values": {
    "case_count": 6,
    "always_ok_status": 200,
    "always_ok_cors_header_count": 3,
    "always_err_status": 500,
    "always_err_cors_header_count": 3,
    "noalways_ok_status": 200,
    "noalways_ok_cors_header_count": 3,
    "noalways_err_status": 500,
    "noalways_err_cors_header_count": 0,
    "inherit_off_status": 200,
    "inherit_off_cors_header_count": 0,
    "inherit_off_x_extra": true,
    "inherit_merge_status": 200,
    "inherit_merge_cors_header_count": 3,
    "inherit_merge_x_extra": true
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/008-cors.conf",
      "must_contain": [
        "location = /008/always/err { return 500; }",
        "location = /008/inherit/off {",
        "add_header_inherit merge;"
      ]
    }
  ]
}
```
