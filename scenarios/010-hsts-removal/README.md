# 010-hsts-removal

HSTS を登録したあと、それを **解除できるのか** を 3 エンジンで測る。

```bash
docker compose up -d --wait
./scenarios/010-hsts-removal/run.sh
```

出力は `results/010-hsts-removal/{summary.json,run.log}`。期待値は [`expected.md`](expected.md)。

## 設計上の要点

- **ポートを見せない。**RFC 6797 §8.3 の upgrade は明示ポートを保持するため、`:8094` のまま
  測ると upgrade 先が平文になり必ず失敗する。`tools/hsts-proxy.mjs` が `:80` / `:443` に見せる。
- **ホスト名で測る。**HSTS は IP アドレスに適用されない（RFC 6797 §8.1.1）。
- **ケースごとにプロファイルを作り直す。**HSTS は残るため、使い回すと前のケースが次を汚染する。
- **子は STS を送らない。**送ると親の `includeSubDomains` の効果と子自身の登録を区別できない。
