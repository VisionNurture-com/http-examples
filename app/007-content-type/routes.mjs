// 007 — Content-Type とボディ表現
// 🔴 観測対象: Express は Content-Type 不一致で 415 を返すのか（返さない想定・実測で確定する）
// 先回りで 415 を返す実装を足さない。既定の挙動をそのまま測る。
import express from "express";

export function register(app) {
  app.post("/007/echo", express.json(), (req, res) => {
    res.json({ received: req.body ?? null, contentType: req.headers["content-type"] ?? null });
  });

  // nosniff の有無で解釈が変わるかを測るため、宣言だけ違う 2 経路を用意する
  app.get("/007/text-as-html", (_req, res) => {
    res.set("Content-Type", "text/plain");
    res.send("<b>bold</b>");
  });
  app.get("/007/text-as-html-nosniff", (_req, res) => {
    res.set("Content-Type", "text/plain");
    res.set("X-Content-Type-Options", "nosniff");
    res.send("<b>bold</b>");
  });
}
