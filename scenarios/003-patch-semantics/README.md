# 003-patch-semantics

PATCH の再送で状態がどう動くかを、2 つの形式 × 2 つの操作で測ります。

## 何を測るか

同じパッチ本文を 3 回送り、相異なる状態の数を数えます。

| ケース | メディアタイプ | 送る内容 |
|---|---|---|
| `merge_set` | `application/merge-patch+json` | `{"title":"final"}` |
| `merge_delete` | `application/merge-patch+json` | `{"title":null}` |
| `json_replace` | `application/json-patch+json` | `[{"op":"replace","path":"/title","value":"final"}]` |
| `json_add_append` | `application/json-patch+json` | `[{"op":"add","path":"/tags/-","value":"rest"}]` |

## 実行

```bash
docker compose up -d --wait
bash scenarios/003-patch-semantics/run.sh
```

## 測り方の注意

サーバ側は JSON Merge Patch（RFC 7386）と JSON Patch（RFC 6902）の最小実装です。`add` / `replace` / `remove` だけを扱い、測る範囲に絞っています。既定の `express.json()` は独自のメディアタイプを拾わないため、両方を JSON として受けるよう `type` を明示しています。
