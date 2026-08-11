// 009 — 認証・認可
// 観測対象: Authorization ヘッダが届かない経路（リダイレクト・プロキシ越え）
export function register(app) {
  app.get("/009/whoami", (req, res) => {
    res.json({ authorization: req.headers.authorization ?? null });
  });

  // クロスオリジンへのリダイレクト時に Authorization が落ちるかを測る入口
  app.get("/009/redirect", (_req, res) => {
    res.redirect(302, "/009/whoami");
  });
}
