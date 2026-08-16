# 012-vary — 記事に載せる値

> この表の値は `results/012-vary/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-vary",
  "mode": "M1",
  "values": {
    "original_bytes": 100814,
    "novary_second_client_broken": true,
    "withvary_second_client_ok": true
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/012-compression.conf",
      "must_contain": [
        "proxy_cache_path /tmp/nginx-cache-012 keys_zone=cache012:1m levels=1:2 max_size=32m inactive=10m;",
        "location = /012/novary.js {",
        "location = /012/withvary.js {",
        "proxy_cache cache012;"
      ]
    }
  ]
}
```

## 読み方

前段に共有キャッシュ（`proxy_cache`）を置き、**辞書を持つ客 → 持たない客**の順に同じ URL を叩いた結果です。

| 経路 | 1 人目（辞書あり）| 2 人目（辞書なし）|
|---|---|---|
| `Vary` なし | 573 バイト・`dcb`・MISS | **573 バイト・`dcb`・HIT** → 元ファイルと**不一致** |
| `Vary` あり | 573 バイト・`dcb`・MISS | 100,814 バイト・エンコーディングなし・MISS → **一致** |

- 2 人目は `Accept-Encoding` に `dcb` を入れていません。それでも `Vary` を落とすと**キャッシュが差分をそのまま配ります**
- 🔴 判定は「復号できたか」ではなく **「受け取ったバイト列が元のファイルと一致するか」**で取っています。復号可否はクライアント実装の親切さに左右されます
