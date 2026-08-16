// h2-server.mjs — 103 Early Hints を HTTP/2 + TLS で出す最小サーバ（記事 012 の対照アーム）
//
// なぜ要るか:
//   nginx は上流の 103 を客へ渡さない（実測）。一方 Express 直結は HTTP/1.1 の平文になる。
//   「Chrome が 103 の preload を活かさない」ように見えたとき、それが
//   ブラウザの性質なのか HTTP/1.1・平文という条件のせいなのかを分けられない。
//   そこで 103 を HTTP/2 + TLS で出す経路を用意して対照にする。
//
// 🔴 Express は使わない。フレームワークの既定が挟まると、
//    観測したい 103 の送出タイミングがどこで決まったのか分からなくなる。

import { createSecureServer } from "node:http2";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.H2_PORT ?? 3443);
const CERT_DIR = process.env.CERT_DIR ?? "/etc/certs";

const BARE_LINK = "</012/>; rel=preconnect";

// 🔴 Link ヘッダと HTML の href は 1 文字でも違うと別の資源になる。同じ関数から作る
const assetUrl = (cc, nonce) => `/012/eh-asset.css?cc=${encodeURIComponent(cc)}&ms=150&n=${encodeURIComponent(nonce)}`;

const server = createSecureServer({
  key: readFileSync(`${CERT_DIR}/server.key`),
  cert: readFileSync(`${CERT_DIR}/server.crt`),
  allowHTTP1: true,
});

server.on("stream", (stream, headers) => {
  const url = new URL(headers[":path"], "https://localhost");
  const hints = url.searchParams.get("hints") ?? "none";
  const ms = Number.parseInt(url.searchParams.get("ms") ?? "200", 10);
  const cc = url.searchParams.get("cc") ?? "no-store";
  // 🔴 保存可能な資源を繰り返し測ると 2 回目以降はキャッシュから返り、先読みの効果が消える
  const nonce = url.searchParams.get("n") ?? "0";
  const started = process.hrtime.bigint();

  if (url.pathname === "/012/eh-asset.css") {
    const wait = Number.parseInt(url.searchParams.get("ms") ?? "150", 10);
    setTimeout(() => {
      stream.respond({ ":status": 200, "content-type": "text/css", "cache-control": cc });
      stream.end("body{font-family:system-ui;background:#f6f6f6}\n");
    }, wait);
    return;
  }

  if (url.pathname !== "/012/eh") {
    stream.respond({ ":status": 404, "content-type": "text/plain" });
    stream.end("not found\n");
    return;
  }

  // 中間応答（103）。HTTP/2 では additionalHeaders で送る
  if (hints === "preload") stream.additionalHeaders({ ":status": 103, link: `<${assetUrl(cc, nonce)}>; rel=preload; as=style` });
  else if (hints === "bare") stream.additionalHeaders({ ":status": 103, link: BARE_LINK });

  setTimeout(() => {
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    stream.respond({
      ":status": 200,
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "server-timing": `app;dur=${elapsed.toFixed(1)}`,
    });
    stream.end(
      `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">` +
        `<title>012 early hints h2 (${hints})</title>` +
        `<link rel="stylesheet" href="${assetUrl(cc, nonce)}">` +
        `</head><body><h1>h2 hints=${hints} ms=${ms} cc=${cc}</h1></body></html>`
    );
  }, ms);
});

server.listen(PORT, () => {
  console.log(`[h2] listening on ${PORT} (node ${process.versions.node})`);
});
