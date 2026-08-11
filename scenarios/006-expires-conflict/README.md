# 006-expires-conflict — expires と add_header Cache-Control がぶつかったら

## 何を測るか

nginx の公式ドキュメントは `expires` を「Expires と Cache-Control を追加または変更する」と書くだけで、**`add_header Cache-Control` と併用したときに何が起きるかを規定していません**。読み手が調べても答えが載っていない場所です。

あわせて、公式が明記している継承規則の帰結も測ります。

> These directives are inherited from the previous configuration level if and only if there are no `add_header` directives defined on the current level.

つまり**入れ子の内側に `add_header` を 1 本足すと、外側で書いた `Cache-Control` は黙って消えます**。

サーバが何を出すか（curl）と、**それをブラウザがどう扱うか**（3 エンジン）を両方測ります。2 行届いたときにどちらに従うかは、ヘッダを見ただけでは分かりません。

## 埋める欄

実効値カード「書いた値が消える経路」の設定値欄と実効値欄。

## 判定

curl のヘッダ全行 + ブラウザの再取得有無（サーバ側の到着記録）。

## 対照（測定の事前条件）

測定の前に 3 つの対照を取り、1 つでも崩れたら値を書き出さずに中止します。

| 対照 | 変種 | 崩れたときに疑うこと |
|---|---|---|
| 陰性 | `max-age=600` の 2 回目が 0 件 | そもそもキャッシュが働いていない |
| 陽性 | `no-store` の 2 回目が必ず到着 | 観測チャネル（nginx のログ）が死んでいる |
| 条件付き | `no-cache` の 2 回目が 304 | 「訊きに来たこと」を観測できていない |

3 つ目がないと、「到着 0 件」を「条件付きリクエストすら出さなかった」と読むことができません。沈黙と測定値の区別がつかないためです。
