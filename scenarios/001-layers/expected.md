# 001-layers — 記事に載せる値

> この表の値は `results/001-layers/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。
>
> 🔴 **ホスト側の道具の版は `values` に入れません。** `curl` はリポジトリで固定していないため、
> 別のマシンで再実行すると必ず乖離します（CI は Ubuntu の curl 8.5.0 で走り、`curl_version` の
> 突合だけが落ちていました）。測った版は `summary.json` の `versions` と `run.log` に残ります。

```json
{
  "scenario": "001-layers",
  "mode": "M1",
  "values": {
    "exit_K0": 0,
    "time_connect_nonzero_K0": true,
    "arrivals_K0": 1,
    "exit_K1": 6,
    "time_connect_nonzero_K1": false,
    "arrivals_K1": 0,
    "exit_K2": 7,
    "time_connect_nonzero_K2": false,
    "arrivals_K2": 0,
    "exit_K3": 28,
    "time_connect_nonzero_K3": false,
    "arrivals_K3": 0,
    "exit_K4": 60,
    "time_connect_nonzero_K4": true,
    "arrivals_K4": 0,
    "exit_K4b": 60,
    "time_connect_nonzero_K4b": true,
    "arrivals_K4b": 0,
    "exit_K5": 0,
    "time_connect_nonzero_K5": true,
    "arrivals_K5": 1,
    "exit_K6": 0,
    "time_connect_nonzero_K6": true,
    "arrivals_K6": 1,
    "exit_K7": 28,
    "time_connect_nonzero_K7": true,
    "arrivals_K7": 0,
    "chrome_error_K0": "status_200",
    "chrome_error_K1": "net::ERR_NAME_NOT_RESOLVED",
    "chrome_error_K2": "net::ERR_CONNECTION_REFUSED",
    "chrome_error_K4": "net::ERR_CERT_AUTHORITY_INVALID",
    "chrome_error_K4b": "net::ERR_CERT_COMMON_NAME_INVALID",
    "chrome_error_K5": "status_503",
    "chrome_error_K6": "status_502",
    "chrome_error_K7": "net::ERR_CONNECTION_RESET",
    "firefox_error_K0": "status_200",
    "firefox_error_K1": "NS_ERROR_UNKNOWN_HOST",
    "firefox_error_K2": "NS_ERROR_CONNECTION_REFUSED",
    "firefox_error_K4": "SSL_ERROR_UNKNOWN",
    "firefox_error_K4b": "SSL_ERROR_BAD_CERT_DOMAIN",
    "firefox_error_K5": "status_503",
    "firefox_error_K6": "status_502"
  },
  "browsers": ["chrome-real", "firefox-bundled"],
  "config_refs": [
    {
      "path": "nginx/conf.d/001-layers.conf",
      "must_contain": [
        "log_format s001 '$msec",
        "access_log /results/001-layers/access.log s001;",
        "server 127.0.0.1:9;",
        "ssl_certificate     /etc/nginx/certs/wrongname.crt;",
        "ssl_certificate     /etc/nginx/certs/mismatch.crt;"
      ]
    }
  ]
}
```

## 読み方

**終了コードだけでは層が決まりません。**

| ケース | 落とした層 | `curl` の終了コード | `time_connect` | `openssl` の `Verify return code` | サーバへの到着 |
|---|---|:--:|:--:|:--:|:--:|
| K0 | なし（陽性対照）| 0 | あり | 0 | **1 行** |
| K1 | DNS | **6** | 0 | —（名前解決で落ちる）| 0 行 |
| K2 | TCP（拒否）| **7** | 0 | —（接続で落ちる）| 0 行 |
| K3 | TCP（無応答）| **28** | **0** | 適用外 | 0 行 |
| K4 | TLS（自己署名 + 名前不一致）| **60** | あり | **18**（自己署名）| 0 行 |
| K4b | TLS（名前不一致のみ）| **60** | あり | **62**（ホスト名の不一致）| 0 行 |
| K5 | HTTP | **0**（`503`）| あり | 0 | **1 行** |
| K6 | アプリ | **0**（`502`）| あり | 0 | **1 行** |
| K7 | TCP は成立・応答なし | **28** | **あり** | — | 0 行 |

### 同じ値が別の層を指す組み合わせ

| 見えるもの | 該当ケース | 分ける手がかり |
|---|---|---|
| `exit=28` | **K3 / K7** | `time_connect` が 0 か否か |
| `exit=0` | **K0 / K5 / K6** | 応答コード（200 / 503 / 502）|
| `exit=60` + 同じ文言 | **K4 / K4b** | 🔴 **`curl` では分けられない。**`openssl` の `Verify return code`（18 / 62）で分かれる |
| 到着 0 行 | **K1〜K4b / K7** | サーバ側だけでは「届いていない」としか言えない |

## ブラウザ側（M2・実 Chrome 152.0.7977.65 / 同梱 Firefox 153.0）

🔴 **ブラウザのほうが `curl` より細かく分ける層があります。**

| ケース | 落とした層 | Chrome（実機）| Firefox（同梱）| `curl` |
|---|---|---|---|:--:|
| K0 | なし | 200 | 200 | `exit=0` |
| K1 | DNS | `net::ERR_NAME_NOT_RESOLVED` | `NS_ERROR_UNKNOWN_HOST` | `exit=6` |
| K2 | TCP（拒否）| `net::ERR_CONNECTION_REFUSED` | `NS_ERROR_CONNECTION_REFUSED` | `exit=7` |
| K3 | TCP（無応答）| **到達できない** | **到達できない** | `exit=28` |
| **K4** | TLS（自己署名 + 名前不一致）| 🔵 **`net::ERR_CERT_AUTHORITY_INVALID`** | `SSL_ERROR_UNKNOWN` | `exit=60` |
| **K4b** | TLS（名前不一致のみ）| 🔵 **`net::ERR_CERT_COMMON_NAME_INVALID`** | `SSL_ERROR_BAD_CERT_DOMAIN` | `exit=60` |
| K5 | HTTP | 503 | 503 | `exit=0` |
| K6 | アプリ | 502 | 502 | `exit=0` |
| K7 | TCP は成立・応答なし | `net::ERR_CONNECTION_RESET` | （failed が出ずタイムアウト）| `exit=28` |

- 🔴 **K4 と K4b を `curl` は同じ `exit=60` と同じ文言で返し、区別できません。**Chrome は 2 つの別の識別子で返し、`openssl` は `Verify return code` の 18 / 62 で分けます
- 🔴 **Firefox は K4 を `SSL_ERROR_UNKNOWN` としか言いません。**同じ失敗をエンジンが別の粒度で説明します
- **K3 はブラウザから到達できません**（docker network の内側でしか作れないため）
- **K7 は Firefox で `requestfailed` が出ず**、タイムアウトだけが残ります

### 🔴 記事に載せない値（安定しなかったもの）

`PerformanceResourceTiming` のエントリが**失敗時に取れるか**は **3 回の反復で揺れました**（Chrome の K4b と Firefox の K2 が 3 回中 1 回だけ反転）。**確定値として記事に載せません。**
