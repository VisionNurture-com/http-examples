# 004-waf — 記事に載せる値

> この表の値は `results/004-waf/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-waf",
  "mode": "M1",
  "values": {
    "status_passthrough": 200,
    "status_app_forbidden": 403,
    "status_waf_blocked": 403,
    "same_status_app_and_waf": true,
    "content_type_app_forbidden": "text/html; charset=utf-8",
    "content_type_401_through_waf": "application/json; charset=utf-8",
    "cors_added_on_403": "*",
    "cors_added_on_401": null,
    "challenge_through_waf": "Basic realm=\"004\"",
    "retry_after_through_waf": "3",
    "problem_detail_through_waf": true
  }
}
```

## 読み方

**アプリの 403 と WAF の 403 は、コードでは見分けられません。**

| 由来 | コード | 本文 |
|---|:--:|---|
| アプリの認可判断 | 403 | `{"error":"forbidden","arm":"forbidden"}` |
| WAF の遮断 | 403 | `<html><head><title>403 Forbidden</title>...` |

見分けられるのは**本文だけ**です。コードだけを見て再試行や分岐を組むと、「権限がない」と「要求が拒否された」を同じ扱いにしてしまいます。

### 🔴 前段が 403 だけを狙ってヘッダを書き換えた

アプリが返した 403 は本文こそ JSON のまま届きましたが、**`Content-Type` が `application/json` から `text/html` へ書き換わっていました**。

| 経路 | 403 の `Content-Type` | 401 の `Content-Type` |
|---|---|---|
| アプリ直結 | `application/json; charset=utf-8` | `application/json; charset=utf-8` |
| 記事 004 の nginx 経由 | `application/json; charset=utf-8` | `application/json; charset=utf-8` |
| **WAF 経由** | **`text/html; charset=utf-8`** | `application/json; charset=utf-8` |

書き換えは **403 のときだけ**で、401 では起きません。仕掛けは配布イメージの既定設定にあります。

```
more_set_headers -s 403 'Content-Type: ${CORS_HEADER_403_CONTENT_TYPE}';
```

`-s 403` は「ステータスが 403 のときだけ」という指定で、既定値は `CORS_HEADER_403_CONTENT_TYPE=text/html` です。`Access-Control-Allow-Origin: *` も同時に足されます（401 には足されません）。

**これはまさに「汎用 HTTP ソフトがコードを見て何かを変える」実例**です。ただし変えたのは配信の中身ではなく、**受け手が型を判定する手がかり**でした。

- WAF を越えても `WWW-Authenticate` / `Retry-After` / Problem Details の本文は残りました
- **測ったのは配布イメージ 1 つの既定設定**です。設定次第で変わるため、自分の前段で同じことが起きるかは自分で測る必要があります
