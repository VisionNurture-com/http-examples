# 003-redirect-method — 記事に載せる値

> この表の値は `results/003-redirect-method/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "003-redirect-method",
  "mode": "M1",
  "values": {
    "codes_measured": [301, 302, 303, 307, 308],
    "request_body_bytes_sent": 11,
    "method_at_destination": {
      "implicit": { "301": "GET", "302": "GET", "303": "GET", "307": "POST", "308": "POST" },
      "forced": { "301": "POST", "302": "POST", "303": "POST", "307": "POST", "308": "POST" },
      "post30x": { "301": "POST", "302": "POST", "303": "POST", "307": "POST", "308": "POST" }
    },
    "body_bytes_at_destination": {
      "implicit": { "301": 0, "302": 0, "303": 0, "307": 11, "308": 11 },
      "forced": { "301": 0, "302": 0, "303": 0, "307": 11, "308": 11 },
      "post30x": { "301": 11, "302": 11, "303": 11, "307": 11, "308": 11 }
    }
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/003-methods.conf",
      "must_contain": [
        "location = /003/redirect/301 { return 301 /003/sink/301$is_args$args; }",
        "location = /003/redirect/307 { return 307 /003/sink/307$is_args$args; }",
        "absolute_redirect off;"
      ]
    }
  ]
}
```

## 読み方

11 バイトの本文を付けた POST を送り、転送先に**何が届いたか**を記録しています。書き方を 3 通り並べています。

| 書き方 | 301 / 302 / 303 | 307 / 308 |
|---|---|---|
| `-d` だけ（`implicit`）| **GET・本文 0** | POST・本文 11 |
| `-X POST` を足す（`forced`）| **POST・本文 0** | POST・本文 11 |
| `--post301 --post302 --post303` | POST・本文 11 | POST・本文 11 |

`forced` の列が読みどころです。`-X POST` は**メソッド名だけを残し、本文は落ちます**。「POST のまま追いかけた」ようにも「GET に変わった」ようにも見えない、どちらでもない状態が届きます。

測ったクライアントは curl です（版は `results/003-redirect-method/run.log` の先頭）。ブラウザ側は `003-redirect-browser` で測っています。
