# 003-redirect-browser

リダイレクトをブラウザの `fetch` が追ったとき、メソッドとボディがどうなるかを 3 エンジンで測ります。

## 何を測るか

`public/003/blank.html` から同一オリジンの `fetch` で POST を出し、5 つのステータスそれぞれについて転送先の到着記録を取ります。curl 側（`003-redirect-method`）と揃えて読むための対になるシナリオです。

## 実行

```bash
docker compose up -d --wait
npx playwright install
bash scenarios/003-redirect-browser/run.sh
```

## 測り方の注意

エンジンごとに `POST /003/__reset` を挟み、そのエンジンの到着記録だけを読んでいます。
