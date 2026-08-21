# 004-auth-oauth-error — 記事に載せる値

> この表の値は `results/004-auth-oauth-error/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-auth-oauth-error",
  "mode": "M1",
  "values": {
    "status_app_401_invalid_token": 401,
    "challenge_app_401_invalid_token": "Bearer realm=\"004\", error=\"invalid_token\", error_description=\"The access token expired\"",
    "status_app_403_insufficient_scope": 403,
    "challenge_app_403_insufficient_scope": "Bearer realm=\"004\", error=\"insufficient_scope\", scope=\"msgs:read msgs:write\"",
    "content_type_app_403_insufficient_scope": "application/problem+json; charset=utf-8",
    "status_app_403_plain": 403,
    "challenge_app_403_plain": null,
    "status_edge_403_insufficient_scope": 403,
    "challenge_edge_403_insufficient_scope": "Bearer realm=\"004\", error=\"insufficient_scope\", scope=\"msgs:read msgs:write\"",
    "status_waf_403_insufficient_scope": 403,
    "challenge_waf_403_insufficient_scope": "Bearer realm=\"004\", error=\"insufficient_scope\", scope=\"msgs:read msgs:write\"",
    "content_type_waf_403_insufficient_scope": "text/html; charset=utf-8",
    "status_stripped_403_insufficient_scope": 403,
    "challenge_stripped_403_insufficient_scope": null,
    "arms_total": 6,
    "arms_403": 5,
    "arms_403_with_challenge": 3
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/004-status.conf",
      "must_contain": ["proxy_hide_header WWW-Authenticate;"]
    }
  ]
}
```

## 読み方

**403 を返した 5 本のうち、`WWW-Authenticate` を持っていたのは 3 本**でした。

| 返した側 | コード | challenge | `Content-Type` |
|---|:--:|---|---|
| Express（`invalid_token`） | 401 | `Bearer ... error="invalid_token"` | `application/problem+json` |
| Express（`insufficient_scope`） | 403 | `Bearer ... error="insufficient_scope", scope="msgs:read msgs:write"` | `application/problem+json` |
| Express（対照・素の 403） | 403 | **なし** | `application/json` |
| nginx 経由 | 403 | **そのまま残る** | `application/problem+json` |
| WAF 経由 | 403 | **そのまま残る** | 🔴 **`text/html`** |
| nginx（`proxy_hide_header`） | 403 | 🔴 **剥がされる** | `application/problem+json` |

- **「403 に challenge は付かない」は一般則ではありません。**RFC 6750 §3 はアクセスを許さないトークンで来た要求にも `WWW-Authenticate` を MUST とし、§3.1 は `insufficient_scope` に 403 を SHOULD、`scope` 属性の同梱を MAY とします。付かなかったのは `004-auth-challenge` が測った 3 経路（Express の認可判断 / nginx の `deny` / WAF の遮断）が、いずれも challenge を載せない実装だったためです
- 🔴 **WAF は 403 の challenge を残したまま `Content-Type` だけを書き換えました。**`004-waf` で測った「403 のときだけ `text/html` へ書き換える」がここでも起き、**本文は `application/problem+json` のままなのに型の申告だけが `text/html`** になります。`response.json()` を呼ぶクライアントはここで落ちます
- 🔴 **`proxy_hide_header WWW-Authenticate` は 403 の challenge も剥がします。**「401 のダイアログを消す」目的で入れた 1 行が、403 で「何の scope が足りないか」を伝える手段まで一緒に落とします
