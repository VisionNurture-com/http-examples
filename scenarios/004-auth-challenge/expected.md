# 004-auth-challenge — 記事に載せる値

> この表の値は `results/004-auth-challenge/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-auth-challenge",
  "mode": "M1",
  "values": {
    "status_app_none": 401,
    "challenge_app_none": null,
    "status_app_basic": 401,
    "challenge_app_basic": "Basic realm=\"004\"",
    "status_app_bearer": 401,
    "challenge_app_bearer": "Bearer realm=\"004\"",
    "status_app_forbidden": 403,
    "status_stripped_basic": 401,
    "challenge_stripped_basic": null,
    "status_nginx_basic": 401,
    "challenge_nginx_basic": "Basic realm=\"004\"",
    "status_nginx_deny": 403,
    "challenge_nginx_deny": null,
    "arms_total": 8,
    "arms_401": 6,
    "arms_401_with_challenge": 4
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/004-status.conf",
      "must_contain": ["proxy_hide_header WWW-Authenticate;", "auth_basic_user_file", "deny all;"]
    }
  ]
}
```

## 読み方

**401 を返した 6 本のうち、`WWW-Authenticate` を持っていたのは 4 本**でした。

| 返した側 | コード | challenge |
|---|:--:|---|
| Express（付けない実装） | 401 | なし |
| Express（`Basic`） | 401 | `Basic realm="004"` |
| Express（`Bearer`） | 401 | `Bearer realm="004"` |
| nginx の `auth_basic` | 401 | `Basic realm="004"` |
| nginx が `proxy_hide_header` で剥がした | 401 | **なし** |
| Express（403） | 403 | なし |
| nginx の `deny` | 403 | なし |

- **「ダイアログを消したい」で `WWW-Authenticate` を剥がすと、401 のまま challenge が消えます。**RFC 9110 §15.5.2 は challenge を MUST とするので、この応答は仕様に反した 401 になります
- **ここで測った 2 本の 403 には challenge が付きませんでした。**Express の認可判断も nginx の `deny` も、challenge を載せない実装だからです。🔴 **これは「403 には付かない」という一般則ではありません** — RFC 6750 §3.1 は `insufficient_scope` に 403 を SHOULD とし、`scope` 属性を載せた challenge の同梱を MAY としています。付く側は [`004-auth-oauth-error`](../004-auth-oauth-error/expected.md) で測りました
