# 004-retry-clients — 記事に載せる値

> この表の値は `results/004-retry-clients/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "004-retry-clients",
  "mode": "M2",
  "values": {
    "retry_after_seconds": 3,
    "verdict_python-urllib3-retry": "waited",
    "gaps_python-urllib3-retry": [3, 3],
    "verdict_python-requests": "no_retry",
    "verdict_java-httpclient": "no_retry",
    "verdict_go-nethttp": "no_retry",
    "verdict_ruby-nethttp": "no_retry",
    "verdict_bun-fetch": "no_retry",
    "clients_waited": ["python-urllib3-retry"],
    "runtime_versions": {
      "python-urllib3-retry": "urllib3=2.7.0",
      "python-requests": "requests=2.34.2",
      "java-httpclient": "java=25.0.4+7-LTS",
      "go-nethttp": "go=go1.27.0",
      "ruby-nethttp": "ruby=3.4.10",
      "bun-fetch": "bun=1.4.0"
    }
  }
}
```

## 読み方

**6 経路のうち、待って再送したのは 1 つだけ**でした。

| クライアント | 到着回数 | 到着間隔 | 判定 |
|---|:--:|:--:|---|
| Python `urllib3` の `Retry` | 3 | 3 秒 / 3 秒 | **待って再送** |
| Python `requests` | 1 | — | 再送しない |
| Java `HttpClient` | 1 | — | 再送しない |
| Go `net/http` | 1 | — | 再送しない |
| Ruby `Net::HTTP` | 1 | — | 再送しない |
| Bun の `fetch` | 1 | — | 再送しない |

- 🔴 **Python でも結果が分かれます。**`requests` は `urllib3` の上に載っていますが既定の再試行は 0 回で、`Retry(status_forcelist=[429])` を自分で組んだときだけ待ちます。undici の素の `fetch` と `RetryAgent` の関係と同じ形です
- 言語標準のクライアント（Java / Go / Ruby / Bun）は**どれも 429 を素通し**します
- ここまでの 3 シナリオを合わせると、**測った 13 経路のうち待ったのは 3 つ**（`curl --retry` / undici `RetryAgent` / `urllib3` の `Retry`）で、いずれも**再試行を明示的に有効にした場合**です
