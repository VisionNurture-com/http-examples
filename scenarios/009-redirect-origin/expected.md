# 009-redirect-origin の期待値

記事に載せる値の正本。`results/009-redirect-origin/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| クライアント | curl 8.21.0（aarch64-apple-darwin25.4.0 / libcurl 8.21.0 / OpenSSL 3.6.3）|
| 基準のオリジン | `http://localhost:8080` |
| 別オリジン（ポート差）| `http://localhost:8091` |
| 別オリジン（ホスト差）| `http://127.0.0.1:8080` |
| 別オリジン（スキーム差）| `https://localhost:8443` |
| 測定日 | 2026-08-23 |

## 実測結果

`Authorization: Bearer …` を付けて送り、終端に届いたかを読みます。

| ケース | 変わるもの | ホップ | `curl -L`（既定）| `--location-trusted` |
|---|---|:--:|:--:|:--:|
| B0 | 対照（リダイレクトなし）| 0 | **届く** | 届く |
| B1 | パスだけ（同一オリジン）| 1 | **届く** | 届く |
| **B2** | **ポートだけ** | 1 | **落ちる** | 届く |
| **B3** | **ホストだけ** | 1 | **落ちる** | 届く |
| **B4** | スキーム + ポート（http → https）| 1 | **落ちる** | 届く |
| **B5** | **元のオリジンへ復帰**（A→B→A）| 2 | 🔴 **届く** | 届く |
| **B6** | 同一 → 別（A1→A2→B）| 2 | **落ちる** | 届く |

## 読み取り

**ポートが 1 つ違うだけで落ちます**（B2）。同じ `localhost` でも `:8080` と `:8091` は別のオリジンです。ホスト名だけを `127.0.0.1` に変えても同じです（B3）。

🔴 **B5 は仕様の説明と食い違いました。**仕様は「別のオリジンが見えた瞬間に取り除く」と書き、策定時の議論でも `if you go A1 -> B -> A2, A2 doesn't see the header` と説明されています。**取り除いたものは戻らない**という読み方です。ところが curl は、B を経由して元のオリジンへ戻ったとき **`Authorization` を再び送りました**。

curl は仕様のようにヘッダを「削除」しているのではなく、**ホップごとに送信先を見て送るかどうかを決めている**と読めます。だから戻り先が最初のオリジンと一致すれば、また送られます。

`--location-trusted` は 7 ケースすべてで届けます。man page の記述どおりです。

> "Authorization:" and "Cookie:" headers are explicitly not passed on in HTTP requests when following redirects to other origins, unless `--location-trusted` is used.

```json
{
  "scenario": "009-redirect-origin",
  "mode": "M1",
  "values": {
    "cases_total": 7,
    "default_arrived_count": 3,
    "default_arrived_cases": ["B0", "B1", "B5"],
    "trusted_arrived_count": 7,
    "B0_L_auth": "yes",
    "B1_L_auth": "yes",
    "B2_L_auth": "no",
    "B3_L_auth": "no",
    "B4_L_auth": "no",
    "B5_L_auth": "yes",
    "B6_L_auth": "no",
    "B5_L_hops": 2,
    "B6_L_hops": 2,
    "B2_T_auth": "yes",
    "B3_T_auth": "yes",
    "B4_T_auth": "yes"
  },
  "config_refs": [
    { "path": "nginx/conf.d/009-auth.conf", "must_contain": ["listen 91;", "location /009/"] },
    { "path": "compose.yaml", "must_contain": ["\"8091:91\""] }
  ]
}
```
