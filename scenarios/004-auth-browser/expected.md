# 004-auth-browser — 記事に載せる値

> この表の値は `results/004-auth-browser/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-auth-browser",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "arms_tested": ["none", "basic", "bearer", "forbidden", "stripped_basic"],
    "arms_fetch_resolved_all_engines": ["none", "basic", "bearer", "forbidden", "stripped_basic"],
    "arms_www_authenticate_readable": ["basic", "bearer"],
    "native_dialog_observed": "未測定（自動化ブラウザからは観測できない・実 Chrome の手動確認へ切り出す）"
  }
}
```

## 読み方

**`fetch` からは 5 アームとも解決し、コードを読めました。**

| アーム | `fetch` の解決 | `WWW-Authenticate` を読めたか |
|---|:--:|:--:|
| challenge なしの 401 | ✅ | ❌（そもそも無い） |
| `Basic` の 401 | ✅ | ✅ |
| `Bearer` の 401 | ✅ | ✅ |
| 403 | ✅ | ❌（403 には付かない） |
| プロキシで剥がした 401 | ✅ | ❌（**剥がされた**） |

- `fetch` は 401 でも例外を投げません。**エラー処理は自分で書く必要があります**
- 剥がしたアームでは、クライアント側から「どう認証すればよいか」を読む手段が失われました
