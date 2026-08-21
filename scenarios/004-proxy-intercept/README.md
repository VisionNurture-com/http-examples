# 004-proxy-intercept — 本文へ書いた詳細は届くのか

## 何を測るか

RFC 9457 は、コードで運べない詳細を本文へ置く形（Problem Details）を定めています。その本文が**経路の途中で残るか**を、2 つの経路で測ります。

| 経路 | 設定 |
|---|---|
| 素の転送 | `proxy_pass` のみ |
| エラーを差し替える転送 | `proxy_intercept_errors on;` + `error_page` |

あわせて、RFC 9457 §3.1.2 が **MUST** とする「`status` メンバと実際のコードの一致」を意図的に破ったアームも取ります。

## 判定

応答コード・`Content-Type`・本文に詳細（`Your current balance is 30`）が残っているかの 3 点で見ます。コードだけでは「本文が入れ替わった」型を検出できません。

## 記事のどこに出るか

「コードだけでは伝わらない情報の置き場所」の節。**本文へ置けば伝わる、とは限らない**ことの裏づけ。

## 実行

```bash
bash scenarios/004-proxy-intercept/run.sh
```
