# 003-put-idempotent — 記事に載せる値

> この表の値は `results/003-put-idempotent/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "003-put-idempotent",
  "mode": "M1",
  "values": {
    "sends_per_variant": 3,
    "variants_measured": 4,
    "distinct_states_after_sends": {
      "replace": 1,
      "stamped": 3,
      "append": 3,
      "numbered": 3
    },
    "status_sequence": {
      "replace": [200, 200, 200],
      "stamped": [200, 200, 200],
      "append": [200, 200, 200],
      "numbered": [200, 200, 200]
    },
    "control_post_distinct_states": 3,
    "repeats_rejected_by_stack": 0
  },
  "config_refs": [
    {
      "path": "app/003-methods/routes.mjs",
      "must_contain": [
        "app.put(\"/003/put/replace/:id\"",
        "updatedAt: new Date().toISOString()",
        "cur.history.push(req.body)",
        "revision: ++state.revSeq"
      ]
    }
  ]
}
```

## 読み方

同じ本文の PUT を 3 回送り、そのつどサーバ状態を取って**相異なる状態が何通りあったか**を数えています。1 なら 3 回送っても状態は 1 つ、3 なら送るたびに違う状態になったということです。

| 実装 | 相異なる状態 |
|---|:--:|
| 完全置換 | 1 |
| 更新時刻をサーバで打つ | 3 |
| 追記 | 3 |
| 採番 | 3 |
| （対照）POST で毎回作る | 3 |

`repeats_rejected_by_stack` は、この反復を nginx か Express が拒んだ回数です。**0** でした。

`status_sequence` は 3 回それぞれの応答コードです。**4 実装とも `[200, 200, 200]`** で、送るたびに同じコードが返っています。対照の POST だけは 201 が 3 回です。

判定はサーバ状態で行っています。応答が同じかどうかでは判定していません（そちらは `003-delete-repeat` の主題です）。**`status_sequence` は判定に使わず、「応答が同じでも状態は分かれる」ことを同じシナリオの中で示すために記録しています。**
