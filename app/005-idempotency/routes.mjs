// 005 — リトライで二重登録：再送を安全にする
//
// 観測対象: 「冪等キーを付けたのに二重登録が起きる」の機序。
//
// A / B 対照を同じサーバに並べる:
//   A = /005/charge-naive … 素朴な実装。キーは見るが境界を実装していない
//   B = /005/charge       … draft-ietf-httpapi-idempotency-key-header-07 準拠
//   C = /005/charge-pg    … B と同じ判定を、処理中のキーを PostgreSQL の一意制約で確保して行う
//       /005/charge-redis … 同じく Redis の SET NX で確保して行う
//   B-save = /005/charge-save-failures … B と同じだが、失敗した結果（500）も保存して再生する
//
// B の排他（inFlight）はプロセスの中の変数なので、サーバを 2 台に並べると隣の台から見えない。
// C は置き場所だけを 2 台から見える所へ移したもので、判定の分岐（400 / 422 / 409 / 再生）は B と同じ。
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
import pg from "pg";
import { createClient } from "redis";

const naiveStore = new Map(); // key -> { status, body }
const specStore = new Map(); // key -> { status, body, fingerprint, storedAt }
const inFlight = new Set(); // 処理中のキー（B のみ）

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // Stripe の 24 時間に合わせた既定
let charged = 0; // 実際に課金処理が走った回数。二重登録の観測に使う

// ---- 共有ストアへの接続（C 用）--------------------------------------------
// 接続先が無い環境（ほかの記事のシナリオだけを動かす場合など）でもサーバが起動するよう、
// 接続は最初に使うときに張る。張れなければ C は 503 を返す。
let pgPool = null;
function pgClient() {
  if (!process.env.IDEM_PG_URL) return null;
  pgPool ??= new pg.Pool({ connectionString: process.env.IDEM_PG_URL, max: 4 });
  return pgPool;
}

let redisReady = null;
function redisClient() {
  if (!process.env.IDEM_REDIS_URL) return null;
  redisReady ??= createClient({ url: process.env.IDEM_REDIS_URL }).connect();
  return redisReady;
}

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
  app.post("/005/__reset", async (_req, res) => {
    naiveStore.clear();
    specStore.clear();
    inFlight.clear();
    charged = 0;
    // 共有ストアは 2 台で 1 つなので、どちらの台から何回呼ばれても同じ状態になる操作で空にする
    const pool = pgClient();
    if (pool) await pool.query("TRUNCATE idempotency_keys").catch(() => {});
    const redis = redisClient();
    if (redis) await (await redis).flushDb().catch(() => {});
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
      failIfAsked(req);
      specStore.set(key, { status: 201, body, fingerprint: fingerprint(req), storedAt: Date.now() });
      return res.status(201).json(body);
    } catch {
      // B は失敗した結果を保存しない。同じキーで送り直すと、もう一度処理される
      return problem(res, 500, "Charge failed", "The charge failed after it may have been applied.");
    } finally {
      inFlight.delete(key);
    }
  });

  // ---- B-save: 失敗した結果も保存する ------------------------------------
  // Stripe の公開ドキュメントと同じ方針（成功でも失敗でも最初の結果を保存し、500 も再生する）。
  app.post("/005/charge-save-failures", express.json(), async (req, res) => {
    const key = req.headers["idempotency-key"];
    if (!key) {
      return problem(res, 400, "Idempotency-Key is missing", "This operation requires an Idempotency-Key header.");
    }

    const live = specStore.get(key);
    if (live) {
      if (live.fingerprint !== fingerprint(req)) {
        return problem(res, 422, "Idempotency-Key is already used", "This Idempotency-Key was used with a different request payload.");
      }
      res.set("Idempotency-Replayed", "true");
      return res.status(live.status).type(live.type).send(live.raw);
    }
    if (inFlight.has(key)) {
      return problem(res, 409, "A request is outstanding for this Idempotency-Key", "A request with the same Idempotency-Key is still being processed.");
    }

    inFlight.add(key);
    try {
      const body = await doCharge(req);
      failIfAsked(req);
      specStore.set(key, { status: 201, type: "application/json", raw: JSON.stringify(body), fingerprint: fingerprint(req), storedAt: Date.now() });
      return res.status(201).json(body);
    } catch {
      const err = { type: "https://example.com/probs/idempotency", title: "Charge failed", detail: "The charge failed after it may have been applied.", status: 500 };
      specStore.set(key, { status: 500, type: "application/problem+json", raw: JSON.stringify(err), fingerprint: fingerprint(req), storedAt: Date.now() });
      return res.status(500).type("application/problem+json").json(err);
    } finally {
      inFlight.delete(key);
    }
  });

  // ---- C: 処理中のキーを PostgreSQL の一意制約で確保する -------------------
  app.post("/005/charge-pg", express.json(), async (req, res) => {
    const key = req.headers["idempotency-key"];
    if (!key) {
      return problem(res, 400, "Idempotency-Key is missing", "This operation requires an Idempotency-Key header.");
    }
    const pool = pgClient();
    if (!pool) return problem(res, 503, "Store unavailable", "IDEM_PG_URL is not set.");

    const fp = fingerprint(req);
    // 主キーに当たった 2 本目は挿入されず、RETURNING は 0 行になる
    const claimed = await pool.query(
      "INSERT INTO idempotency_keys (key, fingerprint) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key",
      [key, fp],
    );
    if (claimed.rowCount === 0) {
      const { rows: [row] } = await pool.query("SELECT fingerprint, status, body FROM idempotency_keys WHERE key = $1", [key]);
      if (row.fingerprint !== fp) {
        return problem(res, 422, "Idempotency-Key is already used", "This Idempotency-Key was used with a different request payload.");
      }
      if (row.status === null) {
        return problem(res, 409, "A request is outstanding for this Idempotency-Key", "A request with the same Idempotency-Key is still being processed.");
      }
      res.set("Idempotency-Replayed", "true");
      return res.status(row.status).json(row.body);
    }

    try {
      const body = await doCharge(req);
      await pool.query("UPDATE idempotency_keys SET status = 201, body = $2 WHERE key = $1", [key, body]);
      return res.status(201).json(body);
    } catch {
      // 失敗した結果は保存しない（B と同じ）。行を消して、同じキーでの送り直しを受け付ける
      await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [key]).catch(() => {});
      return problem(res, 500, "Charge failed", "The charge failed after it may have been applied.");
    }
  });

  // ---- C: 処理中のキーを Redis の SET NX で確保する -----------------------
  app.post("/005/charge-redis", express.json(), async (req, res) => {
    const key = req.headers["idempotency-key"];
    if (!key) {
      return problem(res, 400, "Idempotency-Key is missing", "This operation requires an Idempotency-Key header.");
    }
    const ready = redisClient();
    if (!ready) return problem(res, 503, "Store unavailable", "IDEM_REDIS_URL is not set.");
    const redis = await ready;

    const fp = fingerprint(req);
    const slot = `idem:${key}`;
    // キーが既にあれば NX で設定されず、null が返る。期限は Stripe に合わせて 24 時間
    const claimed = await redis.set(slot, JSON.stringify({ fp, status: null }), {
      condition: "NX",
      expiration: { type: "PX", value: DEFAULT_TTL_MS },
    });
    if (claimed !== "OK") {
      const row = JSON.parse(await redis.get(slot));
      if (row.fp !== fp) {
        return problem(res, 422, "Idempotency-Key is already used", "This Idempotency-Key was used with a different request payload.");
      }
      if (row.status === null) {
        return problem(res, 409, "A request is outstanding for this Idempotency-Key", "A request with the same Idempotency-Key is still being processed.");
      }
      res.set("Idempotency-Replayed", "true");
      return res.status(row.status).json(row.body);
    }

    try {
      const body = await doCharge(req);
      await redis.set(slot, JSON.stringify({ fp, status: 201, body }), {
        condition: "XX",
        expiration: { type: "PX", value: DEFAULT_TTL_MS },
      });
      return res.status(201).json(body);
    } catch {
      await redis.del(slot).catch(() => {});
      return problem(res, 500, "Charge failed", "The charge failed after it may have been applied.");
    }
  });
}

/** 測定用の口。?fail_after_charge=1 のとき、課金のあとで失敗させる（課金は済んでいる）*/
function failIfAsked(req) {
  if (req.query.fail_after_charge === "1") throw new Error("failure after charge");
}
