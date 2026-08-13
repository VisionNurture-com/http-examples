# 003-safe-get — 記事に載せる値

> この表の値は `results/003-safe-get/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "003-safe-get",
  "mode": "M1",
  "values": {
    "get_sends": 3,
    "consumed_after_get_sends": 3,
    "head_sends": 1,
    "consumed_after_head": 1,
    "head_status": 200,
    "head_response_body_bytes": 0,
    "control_safe_get_changed_state": false
  },
  "config_refs": [
    {
      "path": "app/003-methods/routes.mjs",
      "must_contain": [
        "app.get(\"/003/unsafe/consume\"",
        "state.quota[token] = (state.quota[token] ?? 0) + 1"
      ]
    }
  ]
}
```

## 読み方

状態を変える GET を 1 本だけ用意し、2 つの経路から踏みます。

| 経路 | 送った回数 | 消費された回数 |
|---|:--:|:--:|
| GET | 3 | 3 |
| **HEAD** | 1 | **1** |

HEAD の応答は **200・本文 0 バイト**でした。`app.head()` は 1 つも書いていませんが、Express は HEAD を `app.get()` のハンドラへ回します。**本文を返さないだけで、ハンドラは走っています。**

対照として、本当に読むだけの `GET /003/state` を 3 回叩いても状態は動きませんでした（`control_safe_get_changed_state` が `false`）。
