# 012-compression-tradeoff — 記事に載せる値

> この表の値は `results/012-compression-tradeoff/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "012-compression-tradeoff",
  "mode": "M0",
  "values": {
    "level_target_bytes": 100613,
    "br11_vs_br5_bytes_saved": 2501,
    "gzip_min_length_default_spec": 20,
    "gzip_first_win_bytes_compressible": 64,
    "gzip_first_win_bytes_incompressible": 96,
    "br_first_win_bytes_compressible": 48,
    "br_first_win_bytes_incompressible": 32,
    "types_measured": [
      "HTML",
      "JSON（手書き）",
      "JSON（機械生成）",
      "JavaScript",
      "Markdown",
      "既圧縮"
    ]
  }
}
```

## 読み方

### ①-g 水準を上げると何を買っているか

`br -q 5` から `-q 11` へ上げて減るのは **2,494 バイト（対象の 2.5%）**です。その代わり圧縮時間は桁で増えます。

🔴 **時間の値は `values` に入れていません。**実行のたびに変わるため、突合すると再現できないからです。実測の並びは `summary.json` の `level_rows` にあります（この実測では `br 11` が `br 5` より 68.053 ms 遅く・**69.6 倍**）。

🔴 ここで測ったのは**同じ入力に対する圧縮アルゴリズムの費用**です。**サーバの処理能力ではありません**。同時接続下のスループットは測っていません。

### ①-h 圧縮が得になる大きさ

| 標本 | gzip が素を下回る最小 | br が素を下回る最小 |
|---|---:|---:|
| 圧縮しやすい（反復のある JSON 風）| **64 バイト** | 48 バイト |
| 圧縮しにくい（16 進の羅列）| **96 バイト** | 32 バイト |

🔴 **nginx の `gzip_min_length` の既定は 20 バイト**（[公式ドキュメント](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)）で、**この境界より下**です。既定のままだと、20〜63 バイトの応答を**膨らませながら圧縮する**ことになります。

境界は中身の圧縮しやすさで動きます。**単一の閾値としては読めません。**

### ①-i コンテンツ種別差

出自を固定した実在ファイルのみを使っています（`summary.json` の `type_samples` に全件記録）。**レンジで読んでください。1 標本から「この種別は N 倍」とは言えません。**

- **既圧縮（`.br` / `.zst` / `.dcb`）は 100.0〜100.7%**。縮まないどころか**わずかに増えます**。二重に圧縮する設定は損しかしません
- **機械生成の JSON は手書きの JSON よりよく縮みます**（反復が多いため）。同じ「JSON」でも性質が違います

### 未測定

- **CSS と SVG**: リポジトリに 500 バイト以上の実在標本がないため測っていません（合成標本で種別差を語ると①-i の前提が崩れます）
- 画像・動画などの既圧縮バイナリ（代わりに `.br` / `.zst` / `.dcb` を既圧縮の代表としています）
- 実サーバでの圧縮スループット・同時接続下の挙動
