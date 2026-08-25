// hsts-proxy.mjs — 010 の測定でブラウザに :80 / :443 を見せるためのローカルプロキシ
//
// 🔴 なぜ要るか:
//   RFC 6797 §8.3 の upgrade はスキームだけを置き換え、明示されたポートを保持する。
//   http://example.test:8094 は https://example.test:8094 へ上がり、そこは平文なので
//   必ず失敗する。これでは「HSTS が効いた」と「経路が壊れた」を区別できない。
//   プロキシを挟むと URL からポートが消えるため、80 → 443 の素直な upgrade を測れる。
//
// 🔴 なぜ --host-resolver-rules ではないか:
//   あれは Chromium 系にしかない。3 エンジンを同じ土台に載せないと、エンジン差と
//   測定手段の差が混ざる。CONNECT トンネルなら TLS は端点間のままなので、
//   証明書の SAN（example.test / *.example.test）の検証もそのまま通る。
import net from "net";
import http from "http";

const PORT_MAP = { 80: 8094, 443: 8449 };

export async function startProxy() {
  const server = http.createServer((req, res) => {
    let u;
    try {
      u = new URL(req.url.startsWith("http") ? req.url : `http://${req.headers.host}${req.url}`);
    } catch {
      res.writeHead(400).end("bad request-target");
      return;
    }
    const up = http.request(
      {
        host: "127.0.0.1",
        port: PORT_MAP[80],
        path: u.pathname + u.search,
        method: req.method,
        headers: { ...req.headers, host: u.host },
      },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e.message)); });
    req.pipe(up);
  });

  server.on("connect", (req, sock, head) => {
    const want = Number(req.url.split(":")[1] || 443);
    const port = PORT_MAP[want];
    if (!port) { sock.end("HTTP/1.1 502 unmapped port\r\n\r\n"); return; }
    const up = net.connect(port, "127.0.0.1", () => {
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    up.on("error", () => sock.destroy());
    sock.on("error", () => up.destroy());
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}
