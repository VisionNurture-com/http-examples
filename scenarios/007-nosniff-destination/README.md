# 007-nosniff-destination（M2）

## 何を測るか

同じ「型を偽った素材」を **4 つの destination**（classic script / module script / style / document）から読み、`X-Content-Type-Options: nosniff` の有無で挙動が変わるかを 3 エンジンで測ります。

`nosniff` によるブロックは仕様上 script-like と `"style"` にしか適用されません。**document ナビゲーション（D11 / D12）は対照**で、差が出ないこと自体が「`nosniff` がないと `text/plain` が HTML として解釈される」という通説の反証になります。

## カードのどの欄を埋めるか

| 欄 | 値 |
|---|---|
| 設定値 | `Content-Type` を偽り、`X-Content-Type-Options: nosniff` を付ける / 付けない |
| 仕様値 | Fetch Standard §3.6.1 —「Only request destinations that are script-like or "style" are considered」 |
| 実効値 | classic script は `nosniff` があって初めて止まる。module script と style は `nosniff` と無関係に止まる。document は**どちらも止まらない** |
| 出典 | `results/007-nosniff-destination/run.log` + `destination.<browser>.json` |

## 実行

```bash
docker compose up -d --wait
bash scenarios/007-nosniff-destination/run.sh
```
