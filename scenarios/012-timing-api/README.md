# 012-timing-api — Resource Timing の属性は実装に存在するか

## 何を測るか

103 Early Hints が絡むと、応答には時刻が 2 つできます。**先に届く 103** と、**後から届く最終ヘッダ（200 など）**です。Chrome 115 はこの 2 つを測れるように `firstInterimResponseStart` を追加し、同時に `responseStart` の意味を「最終ヘッダ」へ変えました。他のブラウザとツールが追随しなかったため、Chrome 133 でその変更は差し戻され、最終ヘッダの時刻は別の属性として公開されました。

問題はその**属性の名前**です。情報源によって食い違います。

| 情報源 | 書かれている名前 |
|---|---|
| Chrome 133 のリリースノート本文 | `firstResponseHeadersStart` |
| chromestatus のエントリのタイトル | `firstResponseHeadersStart` |
| 同じエントリのサマリー本文 | `finalResponseHeadersStart` |
| W3C Resource Timing の IDL | `finalResponseHeadersStart` |

名前を数えても決まらないため、**実装に問い合わせます**。

## 埋める欄

「TTFB の見かけと実際」を分けて測る節で、読者が実際に書く属性名。

## 判定

`PerformanceResourceTiming.prototype` と `PerformanceNavigationTiming.prototype` への `in` で見ます。

🔴 **インスタンスの値が 0 かどうかでは判定しません**。「属性がない」と「属性はあるが今回の遷移では 0」を分けられないためです。

## 実行

```bash
bash scenarios/012-timing-api/run.sh
```

サーバもコンテナも要りません。playwright の 3 エンジンに加えて、手元にインストールされた Google Chrome（`channel=chrome`）も見ます。
