# 012-lighthouse-ttfb — Lighthouse の「サーバ応答時間」は 103 で何を返すのか

## 何を測るか

`012-timing-api` は、ブラウザが報告する TTFB と `web-vitals` が返す値が、どちらも 103 の到着時刻で決まることを示しました。本シナリオはその続きで、**監査ツールの側**を見ます。

Lighthouse の `server-response-time`（レポート上は "Root document took N ms"）は、サーバの応答が遅いという指摘に使われます。この値が 103 で動くなら、「監査のスコアが良くなった」もまた改善の証拠になりません。

違いはクエリ 1 つだけにしてあります。

| 入口 | 条件 |
|---|---|
| `/012/eh?hints=none` | 103 を送らない（対照）|
| `/012/eh?hints=preload` | 103 で、実際に使う CSS を先読みさせる |

サーバはどちらも同じだけ（200 ミリ秒）待ってから 200 を返します。

## 記事のどこに出るか

判定表「その値を信用してよいか」の、監査ツールが出す値の行。

## 判定

**2 つを分けて見ます。**

1. `server-response-time` が 103 で落ちるか（対照の 1/10 未満を「落ちる」とする）
2. 画面の指標（FCP / LCP）も一緒に動くか（10% 以上の変化を「動いた」とする）

1 だけが起きて 2 が起きないなら、変わったのは測り方であって速さではありません。

あわせて、103 を送るとレポートが `NOT_HTML` で失敗するという [2021 年の報告](https://github.com/GoogleChrome/lighthouse/issues/13379)（同年 12 月に close）が再現するかも記録します。

## 実行

```bash
docker compose up -d
bash scenarios/012-lighthouse-ttfb/run.sh
```

## 出力

- `results/012-lighthouse-ttfb/run.log` — 3 回ぶんの生の値
- `results/012-lighthouse-ttfb/summary.json` — 判定と中央値
