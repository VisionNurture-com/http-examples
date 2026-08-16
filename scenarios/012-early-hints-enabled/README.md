# 012-early-hints-enabled — nginx に `early_hints` を書くと 103 は届くのか

## 何を測るか

`012-early-hints` は、追加設定のない nginx が上流の 103 を客へ渡さないことを 18 通りで示しました。本シナリオはその続きです。nginx 1.29.0 で入った [`early_hints`](https://nginx.org/en/docs/http/ngx_http_core_module.html) ディレクティブを書いたとき、**何が変わって何が変わらないか**を見ます。

違いは nginx の設定 1 行だけにしてあります。

| 入口 | 設定 |
|---|---|
| `/012/eh` | `early_hints` を書かない（既定）|
| `/012/ehon` | `early_hints $early_hints_on;` を書く。ほかは同一で、同じアプリの同じ経路へ回す |

## 埋める欄

決定表「その改善は本物か」の、自分の構成で先読みを入れるかどうかの判断材料。

## 判定

**2 つを分けて見ます。**

1. **103 が届いたか** — `firstInterimResponseStart` が 0 より大きいこと（全サンプルで）
2. **画面に要る資源が早く来たか** — 先読み対象の `eh-asset.css` の `responseEnd`

🔴 **1 だけを見ると読み違えます。** 103 が届けば報告 TTFB は必ず下がりますが、それは最初の応答が早く届いたという事実を表しているだけで、資源が早く来たことを意味しません。

測定の 1 回目は接続の確立ぶんが乗るため捨て、続く 3 回の中央値を取ります。

## 実行

```bash
bash scenarios/012-early-hints-enabled/run.sh
```

実ブラウザ 3 エンジンを使うため CI では回りません（M2）。
