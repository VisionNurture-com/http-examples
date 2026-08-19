# 002-upgrade — 中継で消えるヘッダ

## 何を測るか

平文のリクエストに `Upgrade:` を付けたときに何が返るか、そして**その先へ渡るか**を測ります。

| 経路 | 見るもの |
|---|---|
| nginx→Express | nginx が `Upgrade` を上流へ渡すか |
| Express 直結 | アプリが `Upgrade` を見るか |

## 仕様側の位置づけ

`Upgrade` の楽観的な使い方には、2026 年 3 月に **RFC 9931**（`Security Considerations for Optimistic Protocol Transitions in HTTP/1.1`・Standards Track）が発行され、**RFC 9112 と RFC 9298 を更新**しました。

🔴 ただしその規範要件の主体は **CONNECT を送るプロキシとプロキシサーバ**です（§8 / §6.3）。本シナリオの実行系にフォワードプロキシは無く、**規範要件そのものは測っていません**。仕様は引用として置き、測った値は下の 3 行だけです。

## 記事のどこに出るか

決定表の「コピーしても意味がないヘッダ」欄。中継を挟むと消えるものは、コピー元とコピー先で同じ要求になりません。

## 実行

```bash
bash scenarios/002-upgrade/run.sh
```
