# 004-retry-undici — 版を固定できる分だけを CI に載せる

## 何を測るか

[`004-retry-after`](../004-retry-after/README.md) と同じ 429 + `Retry-After: 3` を、**リポジトリが版を固定できる 2 経路**だけに投げます。

| クライアント | 版の固定元 |
|---|---|
| Node の組み込み `fetch` | CI の `setup-node`（24 系）|
| undici の `RetryAgent` | `package-lock.json` |

## なぜ分けたか

🔴 **CI が実測で環境差を検出したためです**（2026-08-20）。`curl --retry 2` は手元の **curl 8.21.0** では 3 秒待って再送しますが、**GitHub Actions の runner に入っている curl では再送しませんでした**。

curl はリポジトリが版を固定できないホストのツールです。固定できない値を CI の突合に載せると、**設定値の陳腐化ではなく環境差を検知する**ことになり、赤の意味が変わってしまいます。curl を含む全経路は M2 側（`004-retry-after`）で測り、版を明記します。

## 判定

サーバ側の到着間隔（nginx の `$msec`）で 3 値判定します。

## 記事のどこに出るか

実効値の表「Retry-After に従うのは誰か」の裏づけのうち、**再現性を CI が保証している部分**。

## 実行

```bash
bash scenarios/004-retry-undici/run.sh
```
