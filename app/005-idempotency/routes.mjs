// 005 — リトライで二重登録：再送を安全にする
//
// 観測対象: 「冪等キーを付けたのに二重登録が起きる」の機序。
//
// A / B 対照を同じサーバに並べる:
//   A = /005/charge-naive … 素朴な実装。キーは見るが境界を実装していない
//   B = /005/charge       … draft-ietf-httpapi-idempotency-key-header-07 準拠
//
// 🔴 ドラフトは 2026-04-18 に失効している（rev 07 / std_level null）。
//    「デファクト標準」の実体は、失効した仕様とそれに完全には従わない実装である。
//    v07 が SHOULD で定めるのは 400（キー欠落）/ 422（同一キー・別ペイロード）/
//    409（並行リクエスト）の 3 つ。保存期間の具体値は定めていない。
//
// 🔴 処理に await を 1 つ挟んでいるのは意図的である。
//    実サービスは DB 書き込みで必ず非同期の間が入る。この間が無いと Express の
//    イベントループが 2 本のリクエストを直列化してしまい、素朴実装でも
//    二重登録が再現しない（= 現実と違う結論が出る）。細工ではなく現実の模写。
import express from "express";

const naiveStore = new Map(); // key -> { status, body }
const specStore = new Map(); // key -> { status, body, fingerprint, storedAt }
const inFlight = new Set(); // 処理中のキー（B のみ）

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // Stripe の 24 時間に合わせた既定
let charged = 0; // 実際に課金処理が走った回数。二重登録の観測に使う

/** DB 書き込みを模した非同期の間。0 でも await はイベントループを 1 周させる */
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** 同じリクエストかを判定する指紋。v07 の idempotency fingerprint に相当 */
function fingerprint(req) {
  return JSON.stringify({ path: req.path, body: req.body ?? null });
}

/** v07 の例に倣った problem details（RFC 9457） */
function problem(res, status, title, detail) {
  return res
    .status(status)
    .type("application/problem+json")
    .json({ type: "https://example.com/probs/idempotency", title, detail, status });
}

async function doCharge(req) {
  await settle(); // ← D1 の手当て。ここが無いと K3 が再現しない
  charged += 1;
  return { charged: true, amount: req.body?.amount ?? null, sequence: charged };
}

export function register(app) {
  // ---- 観測用 ----------------------------------------------------------
  app.post("/005/__reset", (_req, res) => {
    naiveStore.clear();
    specStore.clear();
    inFlight.clear();
    charged = 0;
    res.status(204).end();
  });

  app.get("/005/__stats", (_req, res) => {
    res.json({
      charged,
      naive_keys: naiveStore.size,
      spec_keys: specStore.size,
      in_flight: inFlight.size,
    });
  });

  // 接続は成立させ、応答を返さない。カード①（fetch の既定タイムアウト）用。
  // 🔴 測れるのは「応答待ちのタイムアウト」だけで、接続タイムアウトは別物。
  app.get("/005/never-responds", (_req, _res) => {
    /* 意図的に何も返さない。ソケットは開いたままにする */
  });

  // ---- A: 素朴な実装 ---------------------------------------------------
  // キーは見る。しかし別ペイロードの検出も、処理中の排他も、期限もない。
  // 🔴 キーが無ければ冪等性なしでそのまま処理する（= 素朴の定義・D4）。
  app.post("/005/charge-naive", express.json(), async (req, res) => {
    const key = req.headers["idempotency-key"];

    if (key && naiveStore.has(key)) {
      const prev = naiveStore.get(key);
      res.set("Idempotency-Replayed", "true");
      return res.status(prev.status).json(prev.body);
    }

    const body = await doCharge(req);
    if (key) naiveStore.set(key, { status: 201, body });
    return res.status(201).json(body);
  });

  // ---- B: draft v07 準拠 -----------------------------------------------
  app.post("/005/charge", express.json(), async (req, res) => {
    const key = req.headers["idempotency-key"];

    // v07: Idempotency-Key は Item Structured Header の String
    if (!key) {
      return problem(res, 400, "Idempotency-Key is missing", "This operation requires an Idempotency-Key header.");
    }

    const ttlMs = Number(req.query.ttl_ms ?? DEFAULT_TTL_MS);
    const stored = specStore.get(key);

    if (stored && Date.now() - stored.storedAt >= ttlMs) {
      specStore.delete(key); // 期限切れ。v07 は値を定めていない（実装ごとの選択）
    }

    const live = specStore.get(key);
    if (live) {
      // v07: MUST NOT be reused with another request with a different request payload
      if (live.fingerprint !== fingerprint(req)) {
        return problem(res, 422, "Idempotency-Key is already used", "This Idempotency-Key was used with a different request payload.");
      }
      res.set("Idempotency-Replayed", "true");
      return res.status(live.status).json(live.body);
    }

    // v07: The request was retried before the original request completed → 409
    if (inFlight.has(key)) {
      return problem(res, 409, "A request is outstanding for this Idempotency-Key", "A request with the same Idempotency-Key is still being processed.");
    }

    inFlight.add(key);
    try {
      const body = await doCharge(req);
      specStore.set(key, { status: 201, body, fingerprint: fingerprint(req), storedAt: Date.now() });
      return res.status(201).json(body);
    } finally {
      inFlight.delete(key);
    }
  });
}
