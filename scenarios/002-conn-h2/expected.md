# 002-conn-h2 — 記事に載せる値

> この表の値は `results/002-conn-h2/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "002-conn-h2",
  "mode": "M1",
  "values": {
    "connection_specific_headers_tested": ["Connection", "Keep-Alive", "Upgrade", "Transfer-Encoding"],
    "dropped_by_curl_before_send": ["Connection", "Keep-Alive", "Transfer-Encoding", "Upgrade"],
    "reached_server": [],
    "h1_control_status": 200
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/000-base.conf",
      "must_contain": ["http2 on;"]
    }
  ]
}
```

## 読み方

4 本とも、**curl が送信前に落としました**。HEADERS フレームに入っていたのは `user-agent` と `accept` だけです。

| ヘッダ | h2 フレームに入ったか | 応答 |
|---|:--:|:--:|
| `Connection` | いいえ | 200 |
| `Keep-Alive` | いいえ | 200 |
| `Upgrade` | いいえ | 200 |
| `Transfer-Encoding` | いいえ | 200 |

- **サーバは 400 を返しません。**返す機会がないからです。仕様が malformed と定めていても、その判定に届く前にクライアントが落としています
- 対照として、同じ `Connection: keep-alive` を h1 の口へ送ると 200 で通ります
- つまり「h1 のリクエストをコピーして h2 へ投げる」と、**送ったつもりのヘッダが黙って消えます**。エラーは出ません

🔴 落としているのが curl であることは、`> ` 行ではなく `* [HTTP/2] [1] [...]` 行で確認しています。`> ` 行だけを見ると 4 本とも「届いた」と読めてしまいます。
