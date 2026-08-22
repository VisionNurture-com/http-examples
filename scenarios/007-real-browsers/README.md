# 007-real-browsers（M2）

## 何を測るか

[`007-nosniff-destination`](../007-nosniff-destination/README.md) と [`007-worker-mime`](../007-worker-mime/README.md) と**同じケースを、ホストの実ブラウザで**測り直します。

Playwright 1.62.1 が同梱する Firefox は **153.0** で、stable の **154.0** よりメジャーが 1 つ古いためです。中心的な発見（classic worker の MIME 検査）の対照が現行版を指さなくなります。

手段はブラウザで分けます。Chrome は Playwright の `channel: "chrome"` が実バイナリを駆動できます。Firefox と Safari は Playwright から本物を駆動できないため、`/007/selftest` を開いて結果をサーバへ POST させ、それを回収します。

## カードのどの欄を埋めるか

| 欄 | 値 |
|---|---|
| 設定値 | 同梱版と同じケース（destination 10 + worker MIME 7 + document 対照 2） |
| 仕様値 | 同上（Fetch Standard §3.6.1 / HTML Standard） |
| 実効値 | **同梱版と実ブラウザで結果は一致**。Chrome 5/6・Firefox 0/6・Safari 0/6 |
| 出典 | `results/007-real-browsers/run.log` + `real-<browser>.json` |

## 実行

```bash
docker compose up -d --wait
bash scenarios/007-real-browsers/run.sh
```
