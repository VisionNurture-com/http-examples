# 007-worker-mime — 記事に載せる値

> この表の値は `results/007-worker-mime/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "007-worker-mime",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "W1_chromium": "loaded",
    "W1_firefox": "loaded",
    "W1_webkit": "loaded",
    "W2_chromium": "loaded",
    "W2_firefox": "blocked",
    "W2_webkit": "blocked",
    "W3_chromium": "loaded",
    "W4_chromium": "loaded",
    "W5_chromium": "loaded",
    "W6_chromium": "blocked",
    "W7_chromium": "loaded",
    "non_js_loaded_chromium": 5,
    "non_js_loaded_firefox": 0,
    "non_js_loaded_webkit": 0,
    "non_js_types_total": 6
  },
  "config_refs": []
}
```

## 読み方

**仕様は「JavaScript MIME type でなければ読み込まない」と書いています。**

> If all of the following are true: response's URL's scheme is an HTTP(S) scheme; and the result of extracting a MIME type from response's header list is not a JavaScript MIME type, then run onComplete given null, and abort these steps.
> — HTML Standard「fetch a classic worker script」

実測はこう割れました。

| 配った型 | Chromium 151 | Firefox 153 | WebKit 26.5 |
|---|:--:|:--:|:--:|
| `text/javascript`（対照） | 読み込む | 読み込む | 読み込む |
| `text/html` | **読み込む** | 拒否 | 拒否 |
| `text/plain` | **読み込む** | 拒否 | 拒否 |
| `application/json` | **読み込む** | 拒否 | 拒否 |
| `text/css` | **読み込む** | 拒否 | 拒否 |
| `application/octet-stream` | **読み込む** | 拒否 | 拒否 |
| `image/png` | 拒否 | 拒否 | 拒否 |

JavaScript MIME type でない 6 種のうち、**Chromium は 5 種を読み込みました**。拒否したのは `image/png` だけです。Firefox と WebKit は 6 種すべてを拒否しています。

つまり **Chromium で動いたことは、型が正しいことの証拠になりません**。ここを `nosniff` で塞ぐことはできます（[`007-nosniff-destination`](../007-nosniff-destination/README.md) の D10 では 3 エンジンとも止まりました）が、それは worker 自身の MIME 検査とは別の経路です。

> **測っていない範囲**: 測ったのは classic worker（`new Worker(url)`）だけです。module worker（`{ type: "module" }`）・Service Worker・`importScripts()` は測っていません。ブラウザは Playwright 1.62.1 が同梱する 3 エンジンで、日付は `run.log` の `measured-at:` にあります。
