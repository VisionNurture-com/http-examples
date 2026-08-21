# 004-auth-browser — 401 を自分のコードで処理できるか

## 何を測るか

401 の 5 アーム（challenge なし / `Basic` / `Bearer` / 403 / プロキシで剥がした `Basic`）を、**`fetch` から**と**ナビゲーションから**の 2 通りで見ます。

## 判定

- `fetch` が解決したか、`response.status` と `WWW-Authenticate` を読めたか
- ナビゲーションが応答を返したか

🔴 **ネイティブの認証ダイアログが出たかどうかは、本シナリオでは測りません。**自動化ブラウザは資格情報のプロンプトを自前で打ち切るため、出たかどうかを分けられません。headless と headed の差は [`004-auth-headed`](../004-auth-headed/README.md) が扱います。

## 記事のどこに出るか

実効値の表「401 に添える WWW-Authenticate」。「401 を返すと、自分のコードで処理できるのか」の裏づけ。

## 実行

```bash
bash scenarios/004-auth-browser/run.sh
```
