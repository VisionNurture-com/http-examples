# M3 — Multipass VM での測定

compose では測れないものをここで測ります。**2026-08-13（記事 011 の測定）で実行系を確立しました。**

| 測るもの | なぜ VM が要るか |
|---|---|
| 帯域 / RTT を振った比較 | `tc` / `netem` が Linux カーネルの機能のため |
| HTTP/3 の実測 | **Docker Desktop for Mac の UDP ポート転送では速度比較に使えない**ため |
| ディストリビューションの apt 版が HTTP/3 を話せるか | 実際の Ubuntu が要る |

## 立ち上げ

```bash
multipass launch 26.04 --name h3-2604 --cpus 4 --memory 8G --disk 20G
multipass launch 24.04 --name h3-2404 --cpus 2 --memory 2G --disk 10G   # 比較用
```

### クライアント（HTTP/3 対応 curl）のビルド

**Ubuntu の apt 版 curl は HTTP/3 を話せません。**部品は apt にあるので、同じ版をソースからビルドします。

```bash
sudo apt-get install -y build-essential pkg-config \
  libngtcp2-dev libngtcp2-crypto-ossl-dev libnghttp3-dev libnghttp2-dev libssl-dev libpsl-dev zlib1g-dev nginx
curl -sSLO https://curl.se/download/curl-8.18.0.tar.xz && tar xf curl-8.18.0.tar.xz && cd curl-8.18.0
./configure --prefix=/opt/curl-h3 --with-openssl --with-ngtcp2 --with-nghttp3 --with-nghttp2 \
            --enable-alt-svc --without-libidn2 --without-librtmp --disable-ldap --disable-ldaps
make -j4 && sudo make install
/opt/curl-h3/bin/curl -V | grep HTTP3
```

`libngtcp2-crypto-ossl-dev` は **Ubuntu 26.04 以降**にしかありません（24.04 の OpenSSL 3.0 には QUIC の API が無く、GnuTLS 版のみ）。

## スクリプト

| ファイル | 役割 |
|---|---|
| `setup-011.sh` | 測定トポロジ（netns + veth + 自己署名証明書 + nginx）。**オフロード停止**と `worker_rlimit_nofile` を含む |
| `measure-011.sh` | 帯域 × RTT × ロスの交差点（カード①③④）。`sudo bash measure-011.sh <label> <out_dir>` |
| `measure-011-mux.sh` | 多重化 vs HTTP/1.1（カード②）。`sudo bash measure-011-mux.sh <cfg> <out_dir>` |
| `set-h3buf.sh` | `http3_stream_buffer_size` を切り替えて reload。`sudo bash set-h3buf.sh 64k\|256k\|1m\|4m` |
| `capture-011-card3.sh` | apt 版の HTTP/3 ビルド有無を生ログに落とす |
| `netem.sh` | 回線条件を手で振るときの薄いラッパー |

集計はこのリポジトリの `node tools/aggregate-011.mjs [crossover|control|mux|offload]` で行います（完走した回だけで中央値を出し、タイムアウトは別立てで数える規約）。

### 条件を絞る・分けて回す

高 RTT × ロスの条件は 1 ラベルで 15 分を超えます。環境変数でプロトコルや条件を絞れます。

```bash
# プロトコルを分けて回す（出力は TAG で分ける）
sudo PROTOS=http3-only TAG=-h3 bash measure-011.sh T2c /home/ubuntu/results-011

# 多重化にロスを足す・条件を絞る
sudo LOSS=1% RTTS=100 NLIST="6 25" TAG=-loss1 bash measure-011-mux.sh 64k /home/ubuntu/results-011-mux
```

## 測定するときの注意（011 で踏んだもの）

1. **測定のたびに結果をホストへ退避する。** VM を作り直すと生ログごと消えます（011 の前半で全損しました）。
   ```bash
   multipass transfer h3-2604:/home/ubuntu/results-011/xxx.jsonl ./results/011-protocol/
   ```
2. **RTT は設定値でラベルしない。** VM のタイマ揺れで実効 RTT の裾が伸びます。`measure-011.sh` は条件ごとに TCP ハンドシェイクを 15 回測り、min / median / p90 を記録します。**p90 が min の 3 倍を超える条件は測定条件として使えません。**
3. **オフロードを切る。** GSO が有効だと `netem` が 64 KiB のスーパーパケットを見ることになり、`limit` の意味が壊れます。
4. **`netem` の `limit` は帯域遅延積から計算する。** 既定 1000 パケットでは 1 Gbps × RTT 100ms（約 8,300 パケット相当）を捌けません。
5. **VM の起動パラメータを変えない。** 011 で `idle=poll` を入れて再起動したところ qemu がクラッシュし、VM に入れなくなりました。精度の問題は**設定で消すのではなく実測して開示**します。

## 測定条件の記録（必須）

M2 / M3 は CI で回りません。**いつ・どの環境で測ったかを `results/<id>/*.log` の先頭に必ず書きます。**

```
measured-at: 2026-08-13T12:15:41Z
host: multipass Ubuntu 26.04 LTS / kernel 7.0.0-28-generic / 4 vCPU
note: M3（手動・CI 対象外）。RTT は設定値でなく実効値を記録する
```

`tools/check-provenance.mjs` は M2 / M3 のシナリオについて `measured-at:` の有無を検査します。
