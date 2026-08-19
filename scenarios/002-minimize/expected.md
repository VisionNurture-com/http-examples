# 002-minimize — 記事に載せる値

> この表の値は `results/002-minimize/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "002-minimize",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "browser_header_count": 12,
    "passes": {
      "static-nginx": {
        "breaks": ["host"],
        "changes": ["accept-encoding"],
        "no_effect_count": 10,
        "minimal_header_count": 2,
        "minimal_set_verified": true,
        "baseline_status": 200
      },
      "static-app": {
        "breaks": ["host"],
        "changes": ["accept-encoding"],
        "no_effect_count": 10,
        "minimal_header_count": 2,
        "minimal_set_verified": true,
        "baseline_status": 200
      },
      "json-nginx": {
        "breaks": ["host"],
        "changes": ["user-agent"],
        "no_effect_count": 11,
        "minimal_header_count": 2,
        "minimal_set_verified": true,
        "baseline_status": 405
      },
      "json-app": {
        "breaks": ["host"],
        "changes": ["Content-Type", "accept-encoding"],
        "no_effect_count": 10,
        "minimal_header_count": 3,
        "minimal_set_verified": true,
        "baseline_status": 200
      }
    }
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/002-minimal.conf",
      "must_contain": [
        "location /002/static/",
        "location /002/api/",
        "gzip on;",
        "gzip_min_length 256;"
      ]
    },
    {
      "path": "app/002-minimal/routes.mjs",
      "must_contain": [
        "app.all(\"/002/api/echo\"",
        "express.raw({ type: \"*/*\", limit: \"10mb\" })"
      ]
    }
  ]
}
```

## 読み方

Chromium 151.0.7922.34 が素のナビゲーションで送ったヘッダは **12 本**でした。その 12 本を curl で再現し、1 本ずつ落として 4 点（status / レスポンスヘッダの集合 / body の SHA-256 / body のバイト数）を比べています。

| 通し | 壊れる | 壊れないが変わる | 変わらない | 最小 |
|---|---|---|---|:--:|
| 静的 GET × nginx 単独 | `host` | `accept-encoding` | 10 本 | **2 本** |
| 静的 GET × nginx→Express | `host` | `accept-encoding` | 10 本 | **2 本** |
| JSON POST × nginx 単独 | `host` | `user-agent` | 11 本 | **2 本** |
| JSON POST × nginx→Express | `host` | `Content-Type` / `accept-encoding` | 10 本 | **3 本** |

- **壊れるのは `host` だけ**です。12 本のうち 11 本は、落としても応答コードが変わりません
- ただし「変わらない」と「壊れない」は別です。`accept-encoding` を落とすと **200 のまま本文が別物**になります（圧縮が消える）
- `JSON POST × nginx→Express` で `Content-Type` を落とすと、**200 が返るのに本文が 0 バイトで届きます**。応答コードだけを見ていると気づけません
- `JSON POST × nginx 単独` の基準は **405** です。静的配信に POST しているため、どのヘッダを削っても 405 のままでした。**ヘッダ以前にメソッドで止まっている**ことが、削って測ると分かります
- `user-agent` が「変わる」側に出るのは 405 の通しだけです。nginx はエラーページを **Chrome / MSIE の User-Agent のときだけ 512 バイト超へ膨らませます**（157 → 559 バイト）

**最小集合は検算しています。**「変わらない」と判定した全ヘッダを**まとめて落とした**リクエストが基準と 4 点とも一致することを、通しごとに確認しました（`minimal_set_verified`）。

🔴 12 本は**この 1 点の測定値**です。ブラウザ・ページの性質・ナビゲーションの種類で変わります。同じ条件で Firefox 153.0 は 11 本、WebKit 26.5 は 9 本でした（`results/002-minimize/browser.*.json`）。

🔴 集合は **nginx を経由してアプリに届いたもの**です。接続固有ヘッダは中継で消えるため、ブラウザが出した集合そのものではありません（消え方は [`002-upgrade`](../002-upgrade/README.md) が測っています）。
