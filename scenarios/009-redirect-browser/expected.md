# 009-redirect-browser の期待値

記事に載せる値の正本。`results/009-redirect-browser/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| Chromium | 151.0.7922.34（Playwright 1.62.1 同梱）|
| Firefox | 153.0（同上。**stable は 154.0** で 1 メジャー古い）|
| WebKit | 26.5（同上。**Safari そのものではない**）|
| ページのオリジン | `http://localhost:8080/009-page/` |
| 測定日 | 2026-08-23 |

## 実測結果

| ケース | 変わるもの | Chromium | Firefox | WebKit |
|---|---|:--:|:--:|:--:|
| B0 | 対照（リダイレクトなし）| 届く | 届く | 届く |
| B1 | パスだけ（同一オリジン）| 届く | 届く | 届く |
| B2 | ポートだけ | 落ちる | 落ちる | 落ちる |
| B3 | ホストだけ | 落ちる | 落ちる | 落ちる |
| B4 | スキーム + ポート | 落ちる | 落ちる | 落ちる |
| **B5** | **元のオリジンへ復帰**（A→B→A）| **落ちる** | **落ちる** | 🔴 **終端に届かない**（`fetch` が失敗）|
| B6 | 同一 → 別（A1→A2→B）| 落ちる | 落ちる | 落ちる |
| **B7** | **サブドメイン**（localhost→sub.localhost）| 落ちる | 落ちる | 落ちる |

### preflight の回数（同じ 8 ケース）

| ケース | Chromium | Firefox | WebKit |
|---|:--:|:--:|:--:|
| B0 / B1 | 0 | 0 | 0 |
| B2 / B3 / B4 / B6 / B7 | **0** | 1 | 1 |
| B5 | **0** | 2 | 2 |

## 読み取り

**3 エンジンとも、いちど落ちた `Authorization` を元のオリジンへ戻っても復活させません**（B5）。仕様の読み方どおりです。**`curl` はここで復活させました**（`009-redirect-origin`）。同じ経路でもクライアントによって届く / 届かないが変わります。

🔴 **Chromium だけ preflight を 1 回も出しませんでした。**`Authorization` を先に削除した結果、残ったのが単純リクエストになるため preflight が要らなくなる、と読めます。Firefox と WebKit はクロスオリジンのホップごとに出しています。**資格情報の判定は 3 エンジンで一致しますが、ワイヤに出るリクエストの数は一致しません。**

🔴 **WebKit だけ B5 で `fetch` そのものが失敗しました**（`Load failed`）。到着記録は 2 ホップで止まっており、元のオリジンへ戻る 3 ホップ目に到達していません。

```json
{
  "scenario": "009-redirect-browser",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "cases_total": 8,
    "arrived_count": 2,
    "arrived_cases": ["B0", "B1"],
    "all_engines_agree": false,
    "B0_auth": "yes",
    "B1_auth": "yes",
    "B2_auth": "no",
    "B3_auth": "no",
    "B4_auth": "no",
    "B6_auth": "no",
    "B7_auth": "no",
    "B7_engines_agree": true,
    "B7_preflight_chromium": 0,
    "B7_preflight_firefox": 1,
    "B7_preflight_webkit": 1,
    "B2_preflight_chromium": 0,
    "B2_preflight_firefox": 1,
    "B2_preflight_webkit": 1,
    "B5_preflight_chromium": 0,
    "B5_preflight_firefox": 2,
    "B5_preflight_webkit": 2,
    "B5_engines_agree": false,
    "B2_preflight_max": 1,
    "B5_preflight_max": 2
  },
  "config_refs": [
    { "path": "nginx/conf.d/000-base.conf", "must_contain": ["location /009-page/"] },
    { "path": "app/009-auth/routes.mjs", "must_contain": ["Access-Control-Allow-Headers", "Authorization, X-Probe"] }
  ]
}
```
