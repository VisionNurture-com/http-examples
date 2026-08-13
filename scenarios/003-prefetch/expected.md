# 003-prefetch — 記事に載せる値

> この表の値は `results/003-prefetch/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "003-prefetch",
  "mode": "M2",
  "values": {
    "prefetch_fired": { "chromium": true, "firefox": true, "webkit": false },
    "consumed_by_prefetch": { "chromium": 1, "firefox": 1, "webkit": 0 }
  },
  "browsers": ["chromium", "firefox", "webkit"],
  "config_refs": [
    {
      "path": "public/003/prefetch.html",
      "must_contain": [
        "<link rel=\"prefetch\" href=\"/003/unsafe/consume?token=prefetch&amp;cs=prefetch\" />"
      ]
    }
  ]
}
```

## 読み方

状態を変える GET を `rel="prefetch"` の対象に置き、ページを開いて 5 秒待ったあとの消費数です。

| エンジン | 踏んだか | 消費数 |
|---|:--:|:--:|
| Chromium 151.0.7922.34 | **踏んだ** | 1 |
| Firefox 153.0 | **踏んだ** | 1 |
| WebKit 26.5 | 踏まなかった | 0 |

nginx 側の到着記録でも、Chromium と Firefox からの GET が 1 件ずつ届いています（WebKit は 0 件）。

**この結果から「WebKit は先読みしない」とは言えません。**測ったのは `rel="prefetch"` という 1 つの経路だけで、投機的な読み込みの全経路ではありません。
