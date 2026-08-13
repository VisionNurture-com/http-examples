# 003-method-override — 記事に載せる値

> この表の値は `results/003-method-override/summary.json` と機械的に突合されます（`npm run check:provenance`）。片方だけ直すと落ちます。

```json
{
  "scenario": "003-method-override",
  "mode": "M2",
  "values": {
    "wire_method_seen_by_app": {
      "chromium": { "form_post_override": "POST", "form_put_attr": "GET", "form_post_plain": "POST", "form_get_plain": "GET", "fetch_put": "PUT" },
      "firefox": { "form_post_override": "POST", "form_put_attr": "GET", "form_post_plain": "POST", "form_get_plain": "GET", "fetch_put": "PUT" },
      "webkit": { "form_post_override": "POST", "form_put_attr": "GET", "form_post_plain": "POST", "form_get_plain": "GET", "fetch_put": "PUT" }
    },
    "handler_reached": {
      "chromium": { "form_post_override": "PUT", "form_put_attr": "GET", "form_post_plain": "POST", "form_get_plain": "GET", "fetch_put": "PUT" },
      "firefox": { "form_post_override": "PUT", "form_put_attr": "GET", "form_post_plain": "POST", "form_get_plain": "GET", "fetch_put": "PUT" },
      "webkit": { "form_post_override": "PUT", "form_put_attr": "GET", "form_post_plain": "POST", "form_get_plain": "GET", "fetch_put": "PUT" }
    },
    "overrides_recorded": { "chromium": 5, "firefox": 5, "webkit": 5 }
  },
  "browsers": ["chromium", "firefox", "webkit"],
  "config_refs": [
    {
      "path": "app/003-methods/routes.mjs",
      "must_contain": [
        "app.use(\"/003/override\", methodOverride(\"_method\"));",
        "original_method: req.originalMethod ?? req.method"
      ]
    },
    {
      "path": "public/003/override.html",
      "must_contain": [
        "method=\"post\" action=\"/003/override/target?_method=PUT&amp;cs=form_post_override\"",
        "method=\"PUT\" action=\"/003/override/target\""
      ]
    }
  ]
}
```

## 読み方

Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5 の 3 エンジンで、**結果はすべて一致**しました。

| 送り方 | ワイヤに出たメソッド | 届いたハンドラ |
|---|---|---|
| `<form method="post">` + `?_method=PUT` | **POST** | PUT |
| `<form method="PUT">` | **GET** | GET |
| `<form method="post">`（対照）| POST | POST |
| `<form method="get">`（対照）| GET | GET |
| `fetch(..., {method:"PUT"})`（対照）| PUT | PUT |

`_method` 偽装は、**ワイヤに PUT を出しません**。POST が届き、サーバ側のミドルウェアが PUT として扱っているだけです。

`<form method="PUT">` と書いた場合は GET になります。HTML の `method` 属性は取りうる値が決まっており、外れた値は既定へ落ちるためです。

ワイヤに出たメソッドは 2 系統で読んでいます（アプリ側の `req.originalMethod` と nginx の `$request_method`）。両者は全ケースで一致しました。nginx 側の記録は `summary.json` の `wire_method_seen_by_nginx` にあります。

## 測った実装

サーバ側の書き換えは `method-override` 3.0.0（`expressjs` org・最終公開 2018-07-12）です。**他のフレームワークの `_method` は測っていません。**
