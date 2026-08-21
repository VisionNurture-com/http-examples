# 004-retry-browser — 記事に載せる値

> この表の値は `results/004-retry-browser/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-retry-browser",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "retry_after_seconds": 3,
    "arrivals_chromium": 1,
    "arrivals_firefox": 1,
    "arrivals_webkit": 1,
    "retry_after_seen_chromium": "3",
    "engines_with_auto_retry": []
  }
}
```

## 読み方

**3 エンジンとも、9 秒待っても再送は届きませんでした。**

| エンジン | 受け取ったコード | `Retry-After` の値 | 9 秒間の到着 |
|---|:--:|:--:|:--:|
| Chromium 151.0.7922.34 | 429 | `3` | 1 回 |
| Firefox 153.0 | 429 | `3` | 1 回 |
| WebKit 26.5 | 429 | `3` | 1 回 |

- `Retry-After` の値は `fetch` から読めます。**読めるが、誰も自動では使いません**
- 待たせたいなら、待つコードを自分で書くことになります
