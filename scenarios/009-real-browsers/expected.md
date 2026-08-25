# 009-real-browsers の期待値

記事に載せる値の正本。`results/009-real-browsers/summary.json` と突合される。

## 実測の条件

| ブラウザ | 実測に使った版 | 上流の最新（2026-08-23）| 判定 |
|---|---|---|---|
| Chrome | 151.0.7922.170 | 152.0.7977.54 | ⚠️ 1 メジャー古い |
| Firefox | 154.0 | 154.0 | ✅ 最新 |
| Safari | 26.5.2 | — | ✅ ホストの最新 |

> UA から読める Chrome の版は `151.0.0.0` に丸められます（Chrome の UA 削減）。実体は 151.0.7922.170 です。

## 実測結果

| ケース | Chrome | Firefox | Safari |
|---|:--:|:--:|:--:|
| B0 | 届く | 届く | 届く |
| B1 | 届く | 届く | 届く |
| B2 | 落ちる | 落ちる | 落ちる |
| B3 | 落ちる | 落ちる | 落ちる |
| B4 | 落ちる | 落ちる | 落ちる |
| **B5** | 落ちる | 落ちる | 🔴 **終端に届かない** |
| B6 | 落ちる | 落ちる | 落ちる |

## 読み取り

**Playwright 同梱版で測った結果と、実ブラウザで測った結果は 7 ケースすべてで一致しました。**Safari 26.5.2 も、同梱の WebKit 26.5 と同じく B5 で `fetch` に失敗します。

一致したと言えるのは、**測ったから**です。同梱の Firefox は 153.0、実物は 154.0 でメジャーが 1 つ違いました。

```json
{
  "scenario": "009-real-browsers",
  "mode": "M2",
  "values": {
    "cases_total": 7,
    "arrived_count": 2,
    "arrived_cases": ["B0", "B1"],
    "browsers_measured": ["chrome", "firefox", "safari"],
    "B0_auth": "yes",
    "B1_auth": "yes",
    "B2_auth": "no",
    "B3_auth": "no",
    "B4_auth": "no",
    "B6_auth": "no",
    "B5_agree": false
  },
  "config_refs": [
    { "path": "public/009/selftest.html", "must_contain": ["/009/report", "MEASUREMENT-TOKEN"] }
  ]
}
```
