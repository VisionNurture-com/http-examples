# 007-worker-mime（M2）

## 何を測るか

`new Worker(url)` で読む素材の `Content-Type` を 7 種類に振り、**どの型なら読み込まれるか**を 3 エンジンで測ります。`nosniff` は付けません——付けると Fetch Standard §3.6.1 の別経路で止まり、classic worker 自身の MIME 検査が働いたかを分離できなくなるためです。

[`007-nosniff-destination`](../007-nosniff-destination/README.md) の D9 で 1 エンジンだけが仕様どおりに止まらなかったため、その範囲を確定させる目的で切り出しました。

## カードのどの欄を埋めるか

| 欄 | 値 |
|---|---|
| 設定値 | worker として配る素材の `Content-Type`（7 種） |
| 仕様値 | HTML Standard「fetch a classic worker script」— JavaScript MIME type でなければ読み込まない |
| 実効値 | Firefox / WebKit は **6/6 拒否**。Chromium は **6 種中 5 種を読み込む**（拒否したのは `image/png` だけ） |
| 出典 | `results/007-worker-mime/run.log` + `worker.<browser>.json` |

## 実行

```bash
docker compose up -d --wait
bash scenarios/007-worker-mime/run.sh
```
