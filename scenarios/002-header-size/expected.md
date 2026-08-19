# 002-header-size — 記事に載せる値

> この表の値は `results/002-header-size/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "002-header-size",
  "mode": "M1",
  "values": {
    "nginx_default_large_client_header_buffers": "4 8k",
    "node_default_max_http_header_size_bytes": 16384,
    "status_single_9000_nginx_static": 400,
    "status_single_9000_via_nginx": 400,
    "status_single_9000_app_direct": 200,
    "status_single_9000_raised": 200,
    "reached_upstream_single_9000_via_nginx": false,
    "boundary_nginx_line_8192_status": 200,
    "boundary_nginx_line_8193_status": 400,
    "app_direct_last_ok_value_bytes": 16347,
    "app_direct_first_431_value_bytes": 16348,
    "first_failing_count_nginx_static": 40,
    "first_failing_count_app_direct": 32,
    "first_failing_count_raised": null,
    "error_page_bytes_with_ua": 233,
    "error_page_bytes_without_ua": 233,
    "status_many_32_via_nginx": 431,
    "status_many_40_via_nginx": 400
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/002-minimal.conf",
      "must_contain": [
        "large_client_header_buffers 8 32k;",
        "server_name headersize.test;"
      ]
    }
  ]
}
```

## 読み方

### 弾いたのが誰かは、応答コードで見分けられる

同じ「大きすぎるヘッダ」でも、**400 と 431 は返した主体が違います**。

| 送ったもの | nginx 単独 | nginx→Express | Express 直結 | 上限を上げた対照 |
|---|:--:|:--:|:--:|:--:|
| 1 本 9,000 バイト | **400** | **400** | 200 | 200 |
| 1,000 バイト × 32 本（約 32 KB）| 200 | **431** | **431** | 200 |
| 1,000 バイト × 40 本（約 40 KB）| **400** | **400** | 431 | 200 |

- **400 は nginx**、**431 は Node** が返しています
- 1 本 9,000 バイトのとき、`nginx→Express` では **echo の本文に自分のヘッダが写りません**（到達していない）。nginx が先に切っています
- 1,000 バイト × 32 本では nginx を素通りし、**その先の Node が 431 を返します**。同じ経路でも、大きさの作り方が変われば弾く主体が入れ替わります

### 境界は 1 バイトまで一致した

| 実装 | 既定 | 実測 |
|---|---|---|
| nginx `large_client_header_buffers` | `4 8k` | ヘッダ行 **8,192 バイトは 200 / 8,193 バイトで 400**。バッファ 1 本ぶんと一致 |
| nginx（本数）| `4 8k` = 合計 32 KB | 約 32.4 KB は 200 / 約 40.5 KB で 400 |
| Node `--max-http-header-size` | 16 KiB | 値 **16,347 バイトは 200 / 16,348 バイトで 431** |

> 🔴 Node 側の 1 バイトの位置は、**curl が既定で送る他のヘッダ（`Host` / `User-Agent` / `Accept`）込みの合計**に依存します。移植できる定数ではありません。

### 上限を上げれば通る

`large_client_header_buffers 8 32k` を書いた server では、A・B のすべてのケースが 200 でした。

### 400 のエラーページは伸びなかった

`405` のときは `User-Agent` の有無で本文が 157 ⟷ 559 バイトに変わりましたが、**この 400 では両方 233 バイト**でした。同じ nginx でも、エラーページの作られ方は状況によって違います。
