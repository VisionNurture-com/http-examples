# 002-accept-encoding — 200 のまま中身が変わる

## 何を測るか

`Accept-Encoding` を削ったときに、応答がどう変わるかを測ります。**壊れないのに中身が変わる**型の代表例です。

## 前提: nginx の既定は gzip off

「削ると圧縮が消える」という現象は、**こちらが `gzip on` を書いて初めて起きます**。この測定は [`nginx/conf.d/002-minimal.conf`](../../nginx/conf.d/002-minimal.conf) で次を設定したうえでの結果です。

```
gzip on;
gzip_types text/plain application/json;
gzip_min_length 256;
```

設定を書かなければ、`Accept-Encoding` は「削っても変わらない」側に入ります。**決定表は設定に依存します。**

## 判定

応答コード、`Content-Encoding`、`Vary`、バイト数を並べて見ます。

## 記事のどこに出るか

決定表の「壊れないが結果が変わる」欄と、その結果が**自分の設定で決まる**という但し書き。

## 実行

```bash
bash scenarios/002-accept-encoding/run.sh
```
