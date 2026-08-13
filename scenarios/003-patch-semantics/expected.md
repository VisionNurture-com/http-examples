# 003-patch-semantics — 記事に載せる値

> この表の値は `results/003-patch-semantics/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "003-patch-semantics",
  "mode": "M1",
  "values": {
    "sends_per_case": 3,
    "cases_measured": 4,
    "media_types_measured": [
      "application/json-patch+json",
      "application/merge-patch+json"
    ],
    "distinct_states_after_sends": {
      "merge_set": 1,
      "merge_delete": 1,
      "json_replace": 1,
      "json_add_append": 3
    },
    "final_state": {
      "merge_set": { "title": "final", "tags": ["http"] },
      "merge_delete": { "tags": ["http"] },
      "json_replace": { "title": "final", "tags": ["http"] },
      "json_add_append": { "title": "draft", "tags": ["http", "rest", "rest", "rest"] }
    }
  },
  "config_refs": [
    {
      "path": "app/003-methods/routes.mjs",
      "must_contain": [
        "app.patch(\"/003/patch/merge\"",
        "app.patch(\"/003/patch/json\"",
        "\"application/merge-patch+json\", \"application/json-patch+json\""
      ]
    }
  ]
}
```

## 読み方

同じパッチ本文を 3 回送り、相異なる状態が何通り現れたかを数えています。

| ケース | 形式 | 送った内容 | 相異なる状態 |
|---|---|---|:--:|
| `merge_set` | JSON Merge Patch | `{"title":"final"}` | 1 |
| `merge_delete` | JSON Merge Patch | `{"title":null}`（削除）| 1 |
| `json_replace` | JSON Patch | `replace /title` | 1 |
| `json_add_append` | JSON Patch | `add /tags/-` | 3 |

3 回送ったあとの `json_add_append` の `tags` は `["http","rest","rest","rest"]` です。分かれたのは**形式ではなく操作**でした。JSON Patch でも `replace` は 1 通りに収まっています。
