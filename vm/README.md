# M3 — Multipass VM での測定

compose では測れないものをここで測ります。

| 測るもの | なぜ VM が要るか |
|---|---|
| 帯域 / RTT / パケットロスを振った比較 | `tc` / `netem` が Linux カーネルの機能のため |
| UDP の GRO 有無によるカーネル受信呼び出し数 | ホストの Docker では観測経路が塞がれる |
| HTTP/2 と HTTP/3 の勝敗が入れ替わる交差点 | 回線条件を再現できないと交差点が出ない |

## 立ち上げ

```bash
multipass launch --name http-examples --cpus 2 --memory 4G --disk 20G
multipass transfer --recursive . http-examples:/home/ubuntu/http-examples
multipass shell http-examples
```

## 測定条件の記録（必須）

M2 / M3 は CI で回りません。**いつ・どの環境で測ったかを `results/<id>/run.log` の先頭に必ず書きます。**

```
measured-at: 2026-08-07T12:34:56Z
host: multipass ubuntu 26.04 / kernel 6.x
note: netem rate=100mbit delay=20ms
```

`tools/check-provenance.mjs` は M2 / M3 のシナリオについて `measured-at:` の有無を検査します。
