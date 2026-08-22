# 007-content-type-parse（M1）

## 何を測るか

型が合わないボディを送ったとき、**nginx と Express のどちらかが止めるか**。10 ケースを 2 経路（nginx 経由 `:8080` / Express 直結 `:8086`）へ同時に送り、ステータスコードと `req.body` が埋まったかを比べます。

対照として、受信側で自分で検査を書いた `/007/echo-strict` を並べます。

## カードのどの欄を埋めるか

| 欄 | 値 |
|---|---|
| 設定値 | `express.json()`（`type` は既定の `application/json` のまま） |
| 仕様値 | RFC 9110 §15.5.16 — 415 は「オリジンサーバが**拒む**」ことの宣言。返す義務は課されていない |
| 実効値 | 型の不一致 4 ケースで **415 は 0 件**。415 が出るのは未知の `Content-Encoding` と未対応 charset の 2 件だけ |
| 出典 | `results/007-content-type-parse/run.log` |

## 実行

```bash
docker compose up -d --wait
bash scenarios/007-content-type-parse/run.sh
```
