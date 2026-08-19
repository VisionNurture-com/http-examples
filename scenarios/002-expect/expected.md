# 002-expect — 記事に載せる値

> この表の値は `results/002-expect/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "002-expect",
  "mode": "M1",
  "values": {
    "sizes_tested": [1024, 1048576, 1048577, 2097152],
    "expect_auto_threshold_bytes": 1048577,
    "default_limit_status_at_2mb": 413,
    "raised_limit_status_at_2mb": 200,
    "raised_limit_sent_100_at_2mb": true,
    "default_limit_sent_100_at_2mb": false
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/002-minimal.conf",
      "must_contain": ["location /002/large/", "client_max_body_size 8m;"]
    }
  ]
}
```

## 読み方

curl 8.21.0 が `Expect: 100-continue` を自動で付け始めたのは **1,048,577 バイト**（1 MiB + 1）でした。ちょうど 1 MiB（1,048,576）では付きません。

| 本文 | curl が付けた | 既定の口 | 上限 8m の口 |
|---:|:--:|---|---|
| 1,024 | いいえ | 200 | 200 |
| 1,048,576 | いいえ | 200 | 200 |
| **1,048,577** | **はい** | **413** | **100 → 200** |
| 2,097,152 | はい | **413** | **100 → 200** |

- **同じ本文が、上限設定の違いだけで 413 と 200 に分かれます**。`Expect` を書いたのは自分ではなく curl です
- 既定の口では **100 Continue が一度も返りません**。nginx は本文を待たずに 413 を返します
- 境界が 1 MiB 付近に 2 つ重なっている点が実務では厄介です。curl が `Expect` を付け始める大きさと、nginx の既定 `client_max_body_size 1m` がほぼ同じ位置にあります

🔴 しきい値は **curl 8.21.0 で測った 1 点**です。他のクライアント（ブラウザ・HTTP ライブラリ）は別の条件で付けます。
