# 012-dictionary — 記事に載せる値

> この表の値は `results/012-dictionary/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-dictionary",
  "mode": "M2",
  "values": {
    "dictionary_bytes": 99465,
    "dictionary_sha256_base64": "waMBlW5oPJ8orWCX6X3OEk82TM6QsDY3P7oauiTTUqo=",
    "target_bytes": 100814,
    "bytes_identity": 100814,
    "bytes_gzip": 30951,
    "bytes_br": 26081,
    "bytes_zstd": 27919,
    "bytes_dcb": 573,
    "bytes_dcz": 591,
    "dictionary_users": [
      "chrome",
      "chromium"
    ]
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/012-compression.conf",
      "must_contain": [
        "map $http_available_dictionary $dict_matched {",
        "map \"$dict_matched:$dict_encoding\" $dict_suffix {",
        "add_header Vary \"Accept-Encoding, Available-Dictionary\" always;",
        "alias /usr/share/nginx/public/012/bundle-v2.js$dict_suffix;",
        "add_header Use-As-Dictionary 'match=\"/012/bundle-*.js\", match-dest=(\"script\"), id=\"bundle-v1\"' always;"
      ]
    }
  ]
}
```

## 読み方

- `bytes_dcb` は**差分が小さいときの数字**です。v2 が v1 とどれだけ違うかで変わります。単独で「辞書は 45 倍効く」と読まないでください
- `dictionary_users` は 2026 年 8 月時点。Firefox 153 / WebKit 26.5 は `Use-As-Dictionary` を受け取っても辞書を申告しません
- 証明書ゲートの切り分け（`localhost` と手元 CA のホスト名）は `summary.json` の `cert_gate_arms` にあります
