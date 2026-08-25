# 010-hsts-ui

`chrome://net-internals/#hsts` の Delete が、**登録経路によって効いたり効かなかったりする**
ことを実 Chrome で測る。

```bash
docker compose up -d --wait
./scenarios/010-hsts-ui/run.sh
```

出力は `results/010-hsts-ui/summary.json`。期待値は [`expected.md`](expected.md)。

## なぜ実 Chrome が要るか

Playwright 同梱の Chromium は `chrome://net-internals` に到達できない（`page.goto` も
CDP の `Page.navigate` も `net::ERR_INVALID_URL`）。`channel: "chrome"` で実バイナリを駆動する。

ユーザーの既定プロファイルは触らない。`mkdtemp` の一時プロファイルを使い、終了時に削除する。
HSTS はプロファイルに残るため、空から始めるのが測定として正しい。
