# 002-upgrade — 記事に載せる値

> この表の値は `results/002-upgrade/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "002-upgrade",
  "mode": "M1",
  "values": {
    "status_without_upgrade": 200,
    "status_with_upgrade_via_nginx": 200,
    "status_with_upgrade_direct": 200,
    "upgrade_forwarded_by_nginx": false,
    "upgrade_seen_when_direct": true,
    "switched_protocols": false
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/002-minimal.conf",
      "must_contain": ["proxy_set_header Host $host;"]
    }
  ]
}
```

## 読み方

| 送り方 | 応答 | 上流が見た `Upgrade` |
|---|:--:|---|
| `Upgrade` なし | 200 | — |
| `Upgrade: websocket`（nginx 経由） | 200 | **なし** |
| `Upgrade: websocket`（Express 直結） | 200 | `websocket` |

- **101 Switching Protocols は一度も返りません。**対応していないサーバは `Upgrade` を無視して通常どおり応答します
- nginx を挟むと、**上流には `Upgrade` が届きません**。接続固有のヘッダは中継ごとに処理され、転送の設定を書かないかぎり先へ渡らないためです
- nginx を外すと、同じリクエストでアプリは `Upgrade` を見ます。**同じヘッダを送っても、経路が違えば届く先が違います**
- したがって、コピーしたリクエストに `Upgrade` が混ざっていても、それは再現に寄与しません

🔴 RFC 9931 の規範要件（プロキシと CONNECT が主体）は、この実行系では測っていません。仕様値として引くだけにとどめています。
