# 002-length — 記事に載せる値

> この表の値は `results/002-length/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "002-length",
  "mode": "M1",
  "values": {
    "body_bytes_sent": 25,
    "status_default": 200,
    "status_without_content_length": 200,
    "status_with_chunked": 200,
    "arrived_bytes_default": 25,
    "arrived_bytes_without_content_length": 0,
    "arrived_bytes_with_chunked": 25,
    "curl_switched_to_chunked": true
  },
  "config_refs": [
    {
      "path": "app/002-minimal/routes.mjs",
      "must_contain": ["bodyBytes: body.length"]
    }
  ]
}
```

## 読み方

25 バイトの JSON を 3 通りで送りました。

| 送り方 | 応答 | サーバに届いたバイト |
|---|:--:|---:|
| 既定 | 200 | 25 |
| `Content-Length` を削除 | **200** | **0** |
| `Transfer-Encoding: chunked` | 200 | 25 |

- **応答は 3 通とも 200 です。**エラーにはなりません
- しかし `Content-Length` を削ると、**サーバに 0 バイトしか届きません**。長さの申告を消したことで、本文が枠組みごと失われます
- 「送ったのに空だった」という症状は、応答コードを見ているかぎり気づけません。**届いたバイト数まで見て初めて分かります**
- 長さを使わない枠組み（chunked）を明示すれば、25 バイトは届きます

🔴 これは curl 8.21.0 の挙動です。長さの申告を消されたときにどう振る舞うかはクライアントによって違います。
