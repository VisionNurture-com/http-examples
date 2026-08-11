// 005 — 失敗時の振る舞い（Idempotency-Key の境界）
// 観測対象: 同じキーの再送で二重処理を防げる範囲と、防げない境界
//
// 保存はプロセス内 Map。再起動で消えるのは仕様であり、
// 「どこまでが Idempotency-Key の責務か」を測るための境界そのもの。
import express from "express";

const store = new Map(); // key -> { status, body }

export function register(app) {
  app.post("/005/charge", express.json(), (req, res) => {
    const key = req.headers["idempotency-key"];
    if (!key) return res.status(400).json({ error: "idempotency_key_required" });

    if (store.has(key)) {
      const prev = store.get(key);
      res.set("Idempotency-Replayed", "true");
      return res.status(prev.status).json(prev.body);
    }

    const body = { charged: true, key, amount: req.body?.amount ?? null };
    store.set(key, { status: 201, body });
    return res.status(201).json(body);
  });
}
