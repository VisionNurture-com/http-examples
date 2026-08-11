// 004 — ステータスコードの選択（401 / 403 / Retry-After の実際）
// 観測対象: 認証と認可の取り違え、Retry-After がクライアントに効くか
export function register(app) {
  app.get("/004/needs-auth", (req, res) => {
    if (!req.headers.authorization) {
      // 401 は「誰か分からない」。WWW-Authenticate は RFC 9110 で必須
      res.set("WWW-Authenticate", 'Bearer realm="004"');
      return res.status(401).json({ error: "unauthenticated" });
    }
    return res.status(403).json({ error: "forbidden" }); // 誰か分かるが権限がない
  });

  app.get("/004/rate-limited", (_req, res) => {
    res.set("Retry-After", "3");
    res.status(429).json({ error: "too_many_requests" });
  });
}
