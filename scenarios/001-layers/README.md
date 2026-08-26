# 001-layers — 観測手段ごとの可視範囲

層ごとに失敗を起こし、**ブラウザ / `curl` / `openssl s_client` / サーバ側の到着記録**が
それぞれ何を返すかを測る。

## 何を作っているか

| ケース | 落とす層 | 作り方 |
|---|---|---|
| K0 | なし（陽性対照）| `nginx` が 200 を返す |
| K1 | DNS | `nonexistent.invalid`（RFC 6761 §6.4 の予約 TLD・必ず引けない）|
| K2 | TCP（拒否）| 誰も待ち受けていないポートへ接続する |
| K3 | TCP（無応答）| `iptables -A INPUT -p tcp --dport 9999 -j DROP`。**docker network の内側から**接続する |
| K4 | TLS | `other.invalid` の自己署名証明書を出す口（**自己署名 + 名前不一致の 2 要因**）|
| K4b | TLS（名前不一致のみ）| `mkcert` が `other.example.test` に発行した証明書を出す口（**CA は信頼される**）|
| K5 | HTTP | `return 503` |
| K6 | アプリ | 上流を discard ポート（RFC 863 の 9 番）に向けて `502` を出させる |
| K7 | TCP は成立・応答なし | K3 と同じ DROP 先へ、**ホストの公開ポート経由で**接続する |

## 判定に使う値

機械可読な値だけを使う。文言は版で変わるため判定に使わない。

- `curl`: **終了コード** + `time_namelookup` / `time_connect` / `time_appconnect`
- `openssl s_client`: **終了コード** + `Verify return code:` の数値
- サーバ側の到着記録: `results/001-layers/access.log` に該当ケースの行が出たか

🔴 **終了コードだけでは層が決まらない。** K3 と K7 はどちらも `exit=28` で、`time_connect` が 0 か否かで分かれる。

## 実行

```bash
bash tools/gen-certs.sh
docker compose up -d --wait
bash scenarios/001-layers/run.sh
```
