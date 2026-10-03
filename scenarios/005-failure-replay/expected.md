# 005-failure-replay の期待値

記事に載せる値の正本。`results/005-failure-replay/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| サーバ | Express 5.2.1（Node 24.19.0）・`app`（`localhost:8086`）1 台 |
| クライアント | Node 24.21.0 の `fetch` |
| 試行 | 各実装 20 回 |
| 測定日 | 2026-10-03 |

## 実測結果

1 本目は課金のあとで失敗させて 500 を返し、2 本目を同じキーで送り直した。

| 実装 | 1 本目 | 2 本目（送り直し）| 課金回数 |
|---|---|---|:--:|
| B: 失敗を保存しない | 500 | **201** | 🔴 **2** |
| B-save: 失敗も保存する | 500 | **500**（保存した結果の再生）| **1** |

## 読み取り

B は 409 / 422 / 400 を正しく返す実装だが、**課金が済んだあとで失敗すると、その結果を保存しないため、送り直しをもう一度処理してしまう**。
20 回すべてで課金が 2 回になった。

B-save は二重課金を防ぐが、送り直しても 500 が返り続けるため、呼び出し側は**課金されたのかどうかを応答からは知れない**。
Stripe の公開ドキュメントも 500 の結果は「不確定として扱う」よう求めており、照合は別の経路（Webhook など）に頼っている。
どちらを選んでも、失敗のあとの扱いを決める仕事は残る。

```json
{
  "scenario": "005-failure-replay",
  "mode": "M1",
  "values": {
    "trials": 20,
    "b_first_statuses": "500x20",
    "b_retry_statuses": "201x20",
    "b_charged": "2x20",
    "b_save_first_statuses": "500x20",
    "b_save_retry_statuses": "500rx20",
    "b_save_charged": "1x20",
    "b_charges_twice_after_failure": true,
    "b_save_charges_once_after_failure": true
  },
  "config_refs": [
    {
      "path": "app/005-idempotency/routes.mjs",
      "must_contain": ["/005/charge-save-failures", "fail_after_charge"]
    }
  ]
}
```
