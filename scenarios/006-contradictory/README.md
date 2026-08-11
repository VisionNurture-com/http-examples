# 006-contradictory — 呪文を全部並べたらどれが効くのか

## 何を測るか

`no-store` `no-cache` `must-revalidate` `max-age` を同時に書いた応答が実際にどう扱われるかを測ります。仕様は優先順位をこう定めています。

> If directives conflict (e.g., both max-age and no-cache are present), the most restrictive directive should be honored.（RFC 9111）

MDN が「実質 `no-store` と等価」と説明している `private, no-cache, no-store, max-age=0, must-revalidate` も、そのまま 1 ケースとして測ります。

`max-age=600, must-revalidate` を入れているのは、**`must-revalidate` が「毎回訊きに行く」指定ではない**ことを確かめるためです。

## 埋める欄

決定表の「ディレクティブの組み合わせ」列。

## 判定

サーバ側の到着記録と status（200 = 取り直し / 304 = 訊きに来た / 0 件 = 訊きにも来ない）。

## 対照（測定の事前条件）

測定の前に 3 つの対照を取り、1 つでも崩れたら値を書き出さずに中止します。

| 対照 | 変種 | 崩れたときに疑うこと |
|---|---|---|
| 陰性 | `max-age=600` の 2 回目が 0 件 | そもそもキャッシュが働いていない |
| 陽性 | `no-store` の 2 回目が必ず到着 | 観測チャネル（nginx のログ）が死んでいる |
| 条件付き | `no-cache` の 2 回目が 304 | 「訊きに来たこと」を観測できていない |

3 つ目がないと、「到着 0 件」を「条件付きリクエストすら出さなかった」と読むことができません。沈黙と測定値の区別がつかないためです。
