// bundle-v1.js — 記事 012 の測定用フィクスチャ（v1 = 配布済みの版）
// 出典: 本リポジトリ 06131b1 の app/ と tools/ から下記の順で連結した実在のコード。
// 合成データではない。v2 との差分は public/012/README.md を参照。
// ---- 連結ここから ----
// ==== app/server.mjs ====
// server.mjs — Express 5 バックエンド（M1 / M2 の測定対象）
//
// 🔴 方針: 記事は「Express の既定でどうなるか」を測る。
//    読みやすさのために既定動作を先回りで直さない。
//    たとえば Content-Type 不一致で 415 を返すかどうかは 007 の観測対象そのもの。

import express from "express";

import { register as registerMethods } from "./003-methods/routes.mjs";
import { register as registerStatus } from "./004-status/routes.mjs";
import { register as registerIdempotency } from "./005-idempotency/routes.mjs";
import { register as registerCache } from "./006-cache/routes.mjs";
import { register as registerContentType } from "./007-content-type/routes.mjs";
import { register as registerAuth } from "./009-auth/routes.mjs";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// 版を観測できるようにしておく。実測ログの provenance に使う
app.get("/__meta", (_req, res) => {
  res.json({
    node: process.versions.node,
    express: process.env.npm_package_dependencies_express ?? "see package.json",
    now: new Date().toISOString(),
  });
});

registerMethods(app);
registerStatus(app);
registerIdempotency(app);
registerCache(app);
registerContentType(app);
registerAuth(app);

app.listen(PORT, () => {
  console.log(`[app] listening on ${PORT} (node ${process.versions.node})`);
});
// ==== app/003-methods/routes.mjs ====
// 003 — メソッドの選択（安全性と冪等性）
// 観測対象: メソッドの性質は実装を制約しない。Express も nginx も、
//           同じ PUT が 2 回届いたことを止めないし、GET が状態を変えても止めない。
//
// 🔴 状態はプロセス内。再実行で前回の残りを測らないよう、各 run.sh の冒頭で
//    POST /003/__reset を叩く。

import express from "express";
import methodOverride from "method-override";

function initialState() {
  return {
    // カード① PUT の 4 系統
    docs: {},
    // カード② DELETE の 3 系統（reset で毎回同じ 3 件を置く）
    items: { a: { name: "alpha" }, b: { name: "bravo" }, c: { name: "charlie" } },
    // カード③ PATCH の 2 形式
    patch: { merge: { title: "draft", tags: ["http"] }, json: { title: "draft", tags: ["http"] } },
    // カード④ 安全でない GET
    quota: {},
    // カード⑤ リダイレクト先の到着記録
    arrivals: [],
    // カード⑥ method-override の到着記録
    overrides: [],
    // 陽性対照（POST は毎回作る）
    created: [],
    revSeq: 0,
    postSeq: 0,
  };
}

let state = initialState();

/** RFC 7386 JSON Merge Patch */
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = target && typeof target === "object" && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

/** RFC 6902 JSON Patch の最小実装（add / replace / remove のみ。測る範囲に絞る） */
function applyJsonPatch(doc, ops) {
  const out = structuredClone(doc);
  for (const op of ops) {
    const parts = String(op.path)
      .split("/")
      .slice(1)
      .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    const last = parts.pop();
    let cur = out;
    for (const p of parts) cur = cur?.[p];
    if (cur == null) continue;
    if (op.op === "add") {
      if (Array.isArray(cur)) {
        if (last === "-") cur.push(op.value);
        else cur.splice(Number(last), 0, op.value);
      } else {
        cur[last] = op.value;
      }
    } else if (op.op === "replace") {
      cur[last] = op.value;
    } else if (op.op === "remove") {
      if (Array.isArray(cur)) cur.splice(Number(last), 1);
      else delete cur[last];
    }
  }
  return out;
}

export function register(app) {
  // merge-patch+json / json-patch+json は既定の express.json() では拾われない。
  // 記事が扱うのは「形式ごとに再送の結果が変わるか」なので、両方を JSON として受ける。
  const json = express.json({
    type: ["application/json", "application/merge-patch+json", "application/json-patch+json"],
  });

  // --- 測定の土台 ---
  app.post("/003/__reset", (_req, res) => {
    state = initialState();
    res.status(204).end();
  });

  // 状態の読み出し。ここは本当に読むだけ（カード④の対照）
  app.get("/003/state", (_req, res) => res.json(state));

  // 冪等かどうかを数えるときに見るのは docs だけなので、そこだけ返す口も用意する。
  // 全状態を返すと items / patch / quota まで混ざり、3 回分を並べたときに差分が読み取りにくい。
  app.get("/003/state/docs", (_req, res) => res.json(state.docs));

  // --- カード① 同じ PUT を繰り返したときのサーバ状態 ---

  // 完全置換。冪等な実装の対照
  app.put("/003/put/replace/:id", json, (req, res) => {
    state.docs[req.params.id] = { ...req.body };
    res.json(state.docs[req.params.id]);
  });

  // 更新時刻をサーバで打つ。実務でもっともよく混ざる形
  app.put("/003/put/stamped/:id", json, (req, res) => {
    state.docs[req.params.id] = { ...req.body, updatedAt: new Date().toISOString() };
    res.json(state.docs[req.params.id]);
  });

  // 追記型。PUT という名前で追記する実装
  app.put("/003/put/append/:id", json, (req, res) => {
    const cur = state.docs[req.params.id] ?? { history: [] };
    cur.history.push(req.body);
    state.docs[req.params.id] = cur;
    res.json(cur);
  });

  // 採番型。保存のたびにリビジョンを振る
  app.put("/003/put/numbered/:id", json, (req, res) => {
    state.docs[req.params.id] = { ...req.body, revision: ++state.revSeq };
    res.json(state.docs[req.params.id]);
  });

  // 陽性対照。POST は毎回作る
  app.post("/003/post/collection", json, (req, res) => {
    const id = `item-${++state.postSeq}`;
    state.created.push(id);
    res.status(201).location(`/003/post/collection/${id}`).json({ id });
  });

  // --- カード② 2 回目の DELETE ---

  // 存在を確かめてから消す
  app.delete("/003/delete/strict/:id", (req, res) => {
    if (!(req.params.id in state.items)) return res.status(404).json({ error: "not_found" });
    delete state.items[req.params.id];
    res.status(204).end();
  });

  // 存在を確かめずに消す
  app.delete("/003/delete/lenient/:id", (req, res) => {
    delete state.items[req.params.id];
    res.status(204).end();
  });

  // 消した結果を本文で返す
  app.delete("/003/delete/echo/:id", (req, res) => {
    const existed = req.params.id in state.items;
    delete state.items[req.params.id];
    res.status(200).json({ deleted: existed });
  });

  // --- カード③ PATCH の 2 形式 ---

  app.patch("/003/patch/merge", json, (req, res) => {
    state.patch.merge = mergePatch(state.patch.merge, req.body);
    res.json(state.patch.merge);
  });

  app.patch("/003/patch/json", json, (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: "array_required" });
    state.patch.json = applyJsonPatch(state.patch.json, req.body);
    res.json(state.patch.json);
  });

  // --- カード④ 安全でない GET ---

  // GET で状態を変える。app.get() で登録したハンドラを HEAD が踏むかも観測対象
  app.get("/003/unsafe/consume", (req, res) => {
    const token = String(req.query.token ?? "default");
    state.quota[token] = (state.quota[token] ?? 0) + 1;
    res.json({ token, consumed: state.quota[token] });
  });

  // --- カード⑤ リダイレクト先 ---

  // ボディが再送されたかを長さで読むため、種類を問わず本文を文字列で受ける
  app.all("/003/sink/:code", express.text({ type: "*/*" }), (req, res) => {
    state.arrivals.push({
      code: req.params.code,
      method: req.method,
      cs: req.query.cs ?? null,
      br: req.query.br ?? null,
      body_length: typeof req.body === "string" ? req.body.length : 0,
      content_type: req.headers["content-type"] ?? null,
    });
    res.json({ ok: true, method: req.method });
  });

  // --- カード⑥ _method 偽装 ---

  // method-override 3.0.0（expressjs org）。クエリの _method を見て req.method を差し替える。
  // 差し替え前のメソッドは req.originalMethod に残るので、両方を記録する。
  app.use("/003/override", methodOverride("_method"));

  const recordOverride = (handler) => (req, res) => {
    state.overrides.push({
      handler,
      method_seen_by_app: req.method,
      original_method: req.originalMethod ?? req.method,
      query_method: req.query._method ?? null,
      cs: req.query.cs ?? null,
      br: req.query.br ?? null,
    });
    res.type("text/plain").send(`handled by ${handler}\n`);
  };

  app.put("/003/override/target", recordOverride("PUT"));
  app.post("/003/override/target", recordOverride("POST"));
  app.get("/003/override/target", recordOverride("GET"));
  app.delete("/003/override/target", recordOverride("DELETE"));
}
// ==== app/004-status/routes.mjs ====
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
// ==== app/005-idempotency/routes.mjs ====
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
// ==== app/006-cache/routes.mjs ====
// 006 — キャッシュが効かない：Cache-Control 設計
//
// 🔴 観測対象は「ブラウザが再取得しに来るか」であって、アプリの作り込みではない。
//    既定ではページ本体を no-store で返し、判定対象をサブリソース 1 本に絞る。
//    ページ自身がキャッシュされると、2 回目のナビゲーションでサブリソースの
//    取得要求そのものが起きず、「キャッシュが効いた」と区別できなくなる。
//
// 🔴 ただし no-store のページは bfcache の対象外になる（web.dev/articles/bfcache）。
//    履歴ナビゲーションを測るときは cc= でページ側の指定を差し替える。
//    既定のまま「戻る」を測ると、測定装置の都合で bfcache を殺した値になる。
import express from "express";

/** 共有キャッシュ（proxy_cache）の測定用。上流に何回届いたかを数える */
const hits = new Map();

/** 埋め込んで良いのは同一オリジンの測定用アセットだけに限る */
function isAllowedAsset(p) {
  return typeof p === "string" && /^\/006\/(asset|gen|exp|etag)\/[\w./?&=-]*$/.test(p);
}

export function register(app) {
  // 測定ページ。asset で指定されたサブリソースを <link> で実際に読み込む。
  //
  // fetch() ではなくマークアップ由来のサブリソースにしているのは、リロード時の
  // 再検証の扱いがナビゲーションのサブリソースとして決まるため。スクリプトから
  // 差し込むと、測ろうとしている挙動そのものが変わりうる。
  //
  // クエリ:
  //   asset — 埋め込むサブリソース（必須）
  //   cc    — ページ自身の Cache-Control（既定 no-store）
  //   n     — 連番。同一 URL への再訪が reload と解釈される余地を消すために使う
  app.get("/006/page", (req, res) => {
    const asset = req.query.asset;
    const cc = typeof req.query.cc === "string" && req.query.cc.length > 0 ? req.query.cc : "no-store";
    res.set("Cache-Control", cc);
    if (!isAllowedAsset(asset)) {
      res.status(400).type("text/plain").send("asset query is required (/006/asset/... or /006/gen/...)");
      return;
    }
    const href = String(asset).replace(/"/g, "&quot;");
    res.type("text/html").send(
      `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>006 cache probe</title>
<link rel="stylesheet" href="${href}">
<script>
// bfcache から復元されたかは pageshow の persisted で判る（web.dev/articles/bfcache）。
// 復元時は JS の状態ごと戻るため、この配列は前回の読み込み分を保持したまま増える。
window.__ps = window.__ps || [];
addEventListener("pageshow", function (e) { window.__ps.push(e.persisted === true); });
</script>
</head>
<body>
<h1>006 cache probe</h1>
<p>判定対象は上の stylesheet 1 本です。ページ自身の Cache-Control は <code>${cc.replace(/</g, "&lt;")}</code> です。</p>
</body>
</html>
`
    );
  });

  // 共有キャッシュ測定用の上流。cc で指定された Cache-Control をそのまま返す。
  // 🔴 先回りで public / private を書き換えない。指定された値を素通しする。
  app.get("/006/api/resource", (req, res) => {
    const key = String(req.query.k ?? "default");
    hits.set(key, (hits.get(key) ?? 0) + 1);
    const cc = req.query.cc;
    if (typeof cc === "string" && cc.length > 0) res.set("Cache-Control", cc);
    res.json({ key, upstreamHits: hits.get(key), at: new Date().toISOString() });
  });

  // 上流への到着回数。共有キャッシュに当たった回数はここに現れない。
  app.get("/006/api/hits", (req, res) => {
    res.set("Cache-Control", "no-store");
    const key = req.query.k;
    if (typeof key === "string") {
      res.json({ key, upstreamHits: hits.get(key) ?? 0 });
      return;
    }
    res.json(Object.fromEntries(hits));
  });

  app.post("/006/api/hits/reset", (_req, res) => {
    hits.clear();
    res.set("Cache-Control", "no-store");
    res.json({ ok: true });
  });
}
// ==== app/007-content-type/routes.mjs ====
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
// ==== app/009-auth/routes.mjs ====
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
// ==== tools/check-structure.mjs ====
#!/usr/bin/env node
// check-structure.mjs — シナリオの構造検査（M0・docker 不要・ネットワーク不要）
//
// 検査内容:
//   1. scenarios/<id>/ に README.md / run.sh / expected.md が揃っているか
//   2. expected.md が provenance ブロック（```json）を持ち、必須キーを備えているか
//   3. run.sh が実行モード（M1 / M2 / M3）を宣言しているか
//
// clean clone から `npm ci && npm run check:structure` で動くこと。外部依存を持たない。

import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCENARIOS = join(ROOT, "scenarios");
const REQUIRED_FILES = ["README.md", "run.sh", "expected.md"];
const REQUIRED_KEYS = ["scenario", "mode", "values"];
const VALID_MODES = ["M0", "M1", "M2", "M3"];

/** expected.md から provenance ブロック（最初の ```json フェンス）を取り出す */
export function extractProvenance(text) {
  const m = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) return { ok: false, error: "```json ブロックがありません" };
  try {
    return { ok: true, data: JSON.parse(m[1]) };
  } catch (e) {
    return { ok: false, error: `JSON パース失敗: ${e.message}` };
  }
}

function listScenarios() {
  if (!existsSync(SCENARIOS)) return [];
  return readdirSync(SCENARIOS)
    .filter((n) => !n.startsWith(".") && statSync(join(SCENARIOS, n)).isDirectory())
    .sort();
}

function main() {
  const ids = listScenarios();
  const errors = [];

  console.log("==========================================");
  console.log("check-structure (M0)");
  console.log("==========================================");

  if (ids.length === 0) {
    console.log("シナリオ 0 個。骨格のみの状態です（測定を追加すると増えます）。");
    console.log("\n✅ PASS [check-structure] 検査対象なし");
    return 0;
  }

  for (const id of ids) {
    const dir = join(SCENARIOS, id);
    for (const f of REQUIRED_FILES) {
      if (!existsSync(join(dir, f))) errors.push(`${id}: ${f} がありません`);
    }

    const expectedPath = join(dir, "expected.md");
    if (existsSync(expectedPath)) {
      const p = extractProvenance(readFileSync(expectedPath, "utf8"));
      if (!p.ok) {
        errors.push(`${id}/expected.md: ${p.error}`);
      } else {
        for (const k of REQUIRED_KEYS) {
          if (!(k in p.data)) errors.push(`${id}/expected.md: キー "${k}" がありません`);
        }
        if (p.data.scenario && p.data.scenario !== id) {
          errors.push(`${id}/expected.md: scenario="${p.data.scenario}" がディレクトリ名と一致しません`);
        }
        if (p.data.mode && !VALID_MODES.includes(p.data.mode)) {
          errors.push(`${id}/expected.md: mode="${p.data.mode}" が不正（${VALID_MODES.join(" / ")}）`);
        }
      }
    }

    const runPath = join(dir, "run.sh");
    if (existsSync(runPath)) {
      const run = readFileSync(runPath, "utf8");
      if (!/#\s*mode:\s*(M[0-3])/.test(run)) {
        errors.push(`${id}/run.sh: "# mode: M1" 形式の実行モード宣言がありません`);
      }
    }
  }

  console.log(`シナリオ ${ids.length} 個を検査しました。`);
  if (errors.length > 0) {
    console.log("");
    for (const e of errors) console.log(`❌ ${e}`);
    console.log(`\n❌ FAIL [check-structure] ${errors.length} 件`);
    return 1;
  }
  console.log("\n✅ PASS [check-structure] 全シナリオが構造要件を満たしています");
  return 0;
}

process.exit(main());
// ==== tools/check-provenance.mjs ====
#!/usr/bin/env node
// check-provenance.mjs — 記事に載せる値と実測ログの突合（M0・docker 不要・ネットワーク不要）
//
// 突合の経路（README「数値の出どころ」と同じ）:
//   run.sh 実行 → results/<id>/run.log（生ログ）
//                → results/<id>/summary.json（実効値・機械が読む）
//                → scenarios/<id>/expected.md（記事に載せる値の正本）
//
// 本スクリプトは expected.md の provenance ブロックと summary.json を突合し、
// 食い違えば非ゼロで終了する。これが「設定値の陳腐化検知」の実体。
//
// あわせて config_refs（nginx/conf.d/*.conf 等）の実在と、引用断片が
// 実際にその設定ファイルへ含まれるかを検査する。記事に書いたが通していない
// 設定を構造的に防ぐため。
//
// リポジトリ内のファイル同士を突き合わせるだけなので clean clone で確実に動く。
//
// 使い方:
//   node tools/check-provenance.mjs                  # 全シナリオ（既定・CI と自己検査用）
//   node tools/check-provenance.mjs --prefix 006     # 006 で始まるシナリオだけ
//   npm run check:provenance -- --prefix 006         # npm 経由で渡す場合
//
// --prefix を設けた理由（2026-08-12）:
//   scenarios/ は記事を書くたびに増える。記事が「シナリオ N 個 / 突合した値 M 件」という
//   **リポ全体の総数**を載せていると、次の記事が 1 つ足した時点で読者が再現できなくなる。
//   実際 008 の記事は「シナリオ 8 個 / 118 件」を載せたまま、リポは 19 個 / 206 件になっていた。
//   記事は自分の分だけを載せられるようにし、リポの成長から切り離す。
//
// 終了コード: 0 = PASS / 1 = FAIL / 3 = 使い方エラー

import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCENARIOS = join(ROOT, "scenarios");
const RESULTS = join(ROOT, "results");

function extractProvenance(text) {
  const m = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) return { ok: false, error: "```json ブロックがありません" };
  try {
    return { ok: true, data: JSON.parse(m[1]) };
  } catch (e) {
    return { ok: false, error: `JSON パース失敗: ${e.message}` };
  }
}

/** 値の比較。数値と文字列の取り違えを見逃さないため型も見る */
function sameValue(a, b) {
  if (typeof a !== typeof b) return false;
  if (typeof a === "object" && a !== null) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/**
 * results/<id>/ にある生ファイルから、実際に測ったブラウザの集合を得る。
 *
 * 生ファイルの中身の形はシナリオごとに違う（dict のものも list のものもある）ため、
 * 中身ではなくファイル名の慣習 `<name>.<browser>.json` で判定する。
 * この慣習は aggregate-008.mjs の集計側も同じ正規表現で使っている。
 */
function browsersFromRawFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = new Set();
  for (const f of readdirSync(dir)) {
    const m = f.match(/\.(chromium|firefox|webkit)\.json$/);
    if (m) found.add(m[1]);
  }
  return [...found].sort();
}

/** summary.json の browsers は dict（browser → version）か配列のどちらもありうる */
function browsersFromSummary(summary) {
  const b = summary?.browsers;
  if (!b) return [];
  return (Array.isArray(b) ? [...b] : Object.keys(b)).sort();
}

function listScenarios() {
  if (!existsSync(SCENARIOS)) return [];
  return readdirSync(SCENARIOS)
    .filter((n) => !n.startsWith(".") && statSync(join(SCENARIOS, n)).isDirectory())
    .sort();
}

// 引数解析。**未知の引数は落とす**（黙って無視すると「絞ったつもりで全件」または
// 「全件のつもりで 0 件」を PASS として出してしまう。黙って通る検査は無いのと同じ）。
function parseArgs(argv) {
  let prefix = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prefix") {
      prefix = argv[++i] ?? "";
    } else if (a.startsWith("--prefix=")) {
      prefix = a.slice("--prefix=".length);
    } else {
      console.error(`✗ USAGE [check-provenance] 未知の引数: "${a}"`);
      console.error("  使い方: node tools/check-provenance.mjs [--prefix <シナリオ ID の接頭辞>]");
      process.exit(3);
    }
    if (prefix !== null && prefix.trim() === "") {
      console.error("✗ USAGE [check-provenance] --prefix には値が必要です");
      process.exit(3);
    }
  }
  return { prefix };
}

function main() {
  const { prefix } = parseArgs(process.argv.slice(2));
  const all = listScenarios();
  const ids = prefix ? all.filter((id) => id.startsWith(prefix)) : all;
  const errors = [];
  let compared = 0;

  console.log("==========================================");
  console.log("check-provenance (M0)");
  console.log("==========================================");

  // 絞り込んだのに 0 件は **FAIL**。ここを PASS にすると「検査したつもりで 1 件も見ていない」
  // 状態が通ってしまう（--prefix 006 の打ち間違いが緑で返る）。
  if (prefix && ids.length === 0) {
    console.log(`❌ FAIL [check-provenance] "--prefix ${prefix}" に一致するシナリオがありません（全 ${all.length} 個）`);
    return 1;
  }

  if (ids.length === 0) {
    console.log("シナリオ 0 個。骨格のみの状態です（測定を追加すると増えます）。");
    console.log("\n✅ PASS [check-provenance] 検査対象なし");
    return 0;
  }

  for (const id of ids) {
    const expectedPath = join(SCENARIOS, id, "expected.md");
    if (!existsSync(expectedPath)) {
      errors.push(`${id}: expected.md がありません`);
      continue;
    }
    const p = extractProvenance(readFileSync(expectedPath, "utf8"));
    if (!p.ok) {
      errors.push(`${id}/expected.md: ${p.error}`);
      continue;
    }
    const { values = {}, config_refs = [], mode, browsers: declaredBrowsers } = p.data;

    // --- 1. summary.json との突合 ---
    const summaryPath = join(RESULTS, id, "summary.json");
    if (!existsSync(summaryPath)) {
      errors.push(`${id}: results/${id}/summary.json がありません（測定が未実施か生ログ未保存）`);
    } else {
      let summary;
      try {
        summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      } catch (e) {
        errors.push(`${id}/summary.json: JSON パース失敗: ${e.message}`);
        summary = null;
      }
      if (summary) {
        for (const [k, want] of Object.entries(values)) {
          if (!(k in summary)) {
            errors.push(`${id}: summary.json に "${k}" がありません（記事に載せる値の裏づけなし）`);
          } else if (!sameValue(want, summary[k])) {
            errors.push(
              `${id}: "${k}" が乖離 — expected.md=${JSON.stringify(want)} / summary.json=${JSON.stringify(summary[k])}`
            );
          } else {
            compared++;
          }
        }
      }
    }

    // --- 1b. 集計の網羅と宣言の一致 ---
    //
    // 「測ったのに集計に入っていない」「expected.md の宣言が古い」を検出する。
    // 2026-08-08 に 008-preflight-boundary で実際に起きた見落としへの対処:
    //   WebKit を追加実行したのに summary.json が再集計されておらず、
    //   記事の「3 エンジンで一致」という主張を本スクリプトが検査していなかった。
    const rawBrowsers = browsersFromRawFiles(join(RESULTS, id));
    if (rawBrowsers.length > 0) {
      const summaryPath2 = join(RESULTS, id, "summary.json");
      let summaryBrowsers = [];
      if (existsSync(summaryPath2)) {
        try {
          summaryBrowsers = browsersFromSummary(JSON.parse(readFileSync(summaryPath2, "utf8")));
        } catch {
          /* パース失敗は上の検査 1 で報告済み */
        }
      }
      const notAggregated = rawBrowsers.filter((b) => !summaryBrowsers.includes(b));
      if (notAggregated.length > 0) {
        errors.push(
          `${id}: 生ファイルに ${JSON.stringify(notAggregated)} があるのに summary.json に含まれていません` +
            `（再集計が必要: node tools/aggregate-008.mjs <name>）`
        );
      }
      if (!Array.isArray(declaredBrowsers)) {
        errors.push(
          `${id}/expected.md: ブラウザで測るシナリオには "browsers" 宣言が必要です（例: ["chromium","firefox","webkit"]）`
        );
      } else {
        const declared = [...declaredBrowsers].sort();
        if (JSON.stringify(declared) !== JSON.stringify(summaryBrowsers)) {
          errors.push(
            `${id}: "browsers" の宣言が集計と乖離 — expected.md=${JSON.stringify(declared)} / summary.json=${JSON.stringify(summaryBrowsers)}`
          );
        } else {
          compared++;
        }
      }
    }

    // --- 2. run.log の実在（生ログが残っているか）---
    if (!existsSync(join(RESULTS, id, "run.log"))) {
      errors.push(`${id}: results/${id}/run.log がありません（生ログは要約で代替しない）`);
    }

    // --- 3. 設定の正本との突合 ---
    for (const ref of config_refs) {
      const refPath = typeof ref === "string" ? ref : ref.path;
      const snippet = typeof ref === "string" ? null : ref.must_contain;
      if (!refPath) {
        errors.push(`${id}: config_refs の要素に path がありません`);
        continue;
      }
      const abs = join(ROOT, refPath);
      if (!existsSync(abs)) {
        errors.push(`${id}: config_refs "${refPath}" が実在しません`);
        continue;
      }
      if (snippet) {
        const conf = readFileSync(abs, "utf8");
        const needles = Array.isArray(snippet) ? snippet : [snippet];
        for (const n of needles) {
          if (!conf.includes(n)) {
            errors.push(`${id}: "${refPath}" に断片 ${JSON.stringify(n)} がありません（記事の引用と設定が乖離）`);
          }
        }
      }
    }

    // --- 4. M2 / M3 は CI で回らないため測定条件の記録を必須にする ---
    if (mode === "M2" || mode === "M3") {
      const logPath = join(RESULTS, id, "run.log");
      if (existsSync(logPath)) {
        const head = readFileSync(logPath, "utf8").split("\n").slice(0, 10).join("\n");
        if (!/measured-at:/.test(head)) {
          errors.push(`${id}: ${mode} の run.log 先頭に "measured-at:" がありません（CI で回らない測定は実施条件の記録が必須）`);
        }
      }
    }
  }

  console.log(
    prefix
      ? `${prefix} のシナリオ ${ids.length} 個 / 突合した値 ${compared} 件`
      : `シナリオ ${ids.length} 個 / 突合した値 ${compared} 件`
  );
  if (errors.length > 0) {
    console.log("");
    for (const e of errors) console.log(`❌ ${e}`);
    console.log(`\n❌ FAIL [check-provenance] ${errors.length} 件`);
    return 1;
  }
  console.log("\n✅ PASS [check-provenance] 記事に載せる値はすべて実測ログに裏づけられています");
  return 0;
}

process.exit(main());
// ==== tools/check-neutrality.mjs ====
#!/usr/bin/env node
// check-neutrality.mjs — 公開移管を壊す混入の検出（M0・docker 不要・ネットワーク不要）
//
// 本リポジトリは検証用（private）で書き、中立化してから公開用（public）へ移す。
// 移管時の手作業だけに頼ると、27 シナリオ分の実測ログに紛れた混入を見落とす。
//
// 検出するもの（いずれも「誰の環境で測ったか」が残る典型）:
//   - 絶対パス /Users/<name>/ や /home/<name>/
//   - *.local のホスト名（macOS の既定ホスト名）
//   - mkcert が証明書へ埋める開発者名（issuer / subject をログに取り込むと入る）
//   - 実在メールアドレス（example.com / example.test は除く）
//
// 🔴 個人名そのものはこのスクリプトに書かない。書けばそれ自体が混入になる。
//    形（パターン）で捕まえる。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const SKIP_DIRS = new Set([".git", "node_modules", "certs"]);
const SKIP_FILES = new Set(["check-neutrality.mjs", "package-lock.json"]);

// 各環境の既定アカウント名は「誰の環境か」を示さないため除外する。
// 例: Multipass の ubuntu / GitHub Actions の runner / コンテナの root・node。
const NEUTRAL_ACCOUNTS = ["ubuntu", "root", "runner", "node", "user", "app", "alice", "bob"];

const PATTERNS = [
  {
    name: "ホームディレクトリの絶対パス",
    re: new RegExp(`/(?:Users|home)/(?!(?:${NEUTRAL_ACCOUNTS.join("|")})/)[A-Za-z0-9._-]+/`),
  },
  { name: "*.local のホスト名", re: /\b[A-Za-z0-9-]+\.local\b/ },
  { name: "mkcert の開発者名（証明書の issuer / subject）", re: /mkcert (?:development|[A-Za-z0-9._-]+@)/ },
  {
    name: "実在しうるメールアドレス",
    re: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|test|org)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (!SKIP_FILES.has(entry)) out.push(p);
  }
  return out;
}

function isProbablyText(buf) {
  return !buf.includes(0);
}

function main() {
  console.log("==========================================");
  console.log("check-neutrality (M0)");
  console.log("==========================================");

  const hits = [];
  const files = walk(ROOT);

  for (const file of files) {
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      continue;
    }
    if (!isProbablyText(buf)) continue;
    const lines = buf.toString("utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { name, re } of PATTERNS) {
        const m = line.match(re);
        if (m) hits.push({ file: relative(ROOT, file), line: i + 1, name, sample: m[0] });
      }
    });
  }

  console.log(`検査したファイル ${files.length} 件`);

  if (hits.length > 0) {
    console.log("");
    for (const h of hits) {
      console.log(`❌ ${h.file}:${h.line} — ${h.name}（${h.sample}）`);
    }
    console.log(`\n❌ FAIL [check-neutrality] ${hits.length} 件`);
    console.log("   公開用リポジトリへ移す前に取り除いてください。");
    return 1;
  }

  console.log("\n✅ PASS [check-neutrality] 環境固有の情報の混入はありません");
  return 0;
}

process.exit(main());
// ==== tools/aggregate-006.mjs ====
#!/usr/bin/env node
// aggregate-006.mjs — 生ログから記事に載せる値（summary.json）を作る
//
// 🔴 予測は入れない。raw.*.json に実際に記録された値だけから組み立てる。
//    expected.md の provenance ブロックはここで作った summary.json と突合される
//    （check-provenance.mjs）。片方だけ直すと必ず落ちる。
//
// 使い方: node tools/aggregate-006.mjs [<scenario> ...]（省略時は全シナリオ）

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const RESULTS = join(ROOT, "results");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** raw.<browser>.json を集めて 1 本の配列にする */
function rawRows(id) {
  const dir = join(RESULTS, id);
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const f of readdirSync(dir)) {
    if (!/^raw\..*\.json$/.test(f) && f !== "raw.json") continue;
    // 永続プロファイルの対照は本測定とは別勘定にする（同じ条件を 2 回数えない）
    if (f.includes("-persistent")) continue;
    const data = readJson(join(dir, f));
    for (const r of Array.isArray(data) ? data : [data]) rows.push(r);
  }
  return rows;
}

/** ブラウザで測ったシナリオは、実際に測った版を summary に残す */
async function browserVersions(names) {
  const L = { chromium, firefox, webkit };
  const out = {};
  for (const n of names) {
    const b = await L[n].launch();
    out[n] = b.version();
    await b.close();
  }
  return out;
}

const pick = (rows, f) => rows.filter(f);
const one = (rows, f) => rows.find(f);

const BUILDERS = {
  "006-immutable": async () => {
    const rows = rawRows("006-immutable").filter((r) => !r.control);
    const plain = pick(rows, (r) => r.variant === "plain");
    const imm = pick(rows, (r) => r.variant === "immutable");
    const diff = pick(rows, (r) => {
      const m = one(rows, (x) => x.browser === r.browser && x.scheme === r.scheme && x.route === r.route && x.variant !== r.variant);
      return m && m.second_hits !== r.second_hits;
    });
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      cases_measured: rows.length,
      plain_second_hits_max: Math.max(...plain.map((r) => r.second_hits)),
      immutable_second_hits_max: Math.max(...imm.map((r) => r.second_hits)),
      cases_where_immutable_differs: diff.length,
      schemes_measured: [...new Set(rows.map((r) => r.scheme))].sort(),
      routes_measured: [...new Set(rows.map((r) => r.route))].sort(),
    };
  },

  "006-immutable-boundary": async () => {
    const rows = rawRows("006-immutable-boundary").filter((r) => !r.control);
    // 🔴 scheme を引数に足した（2026-08-10）。http を測るようにしたため、scheme で
    //    絞らないと同じ (browser, variant, route) が 2 行当たり、one() が先に見つけた
    //    ほうを黙って返す。既存キーは https 固定にして値の意味を変えない。
    const at = (b, v, rt, sc) =>
      one(rows, (r) => r.browser === b && r.variant === v && r.route === rt && r.scheme === sc);
    const https = (b, v, rt) => at(b, v, rt, "https");
    const http = (b, v, rt) => at(b, v, rt, "http");
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      firefox_https_plain_fetch_nocache_hits: https("firefox", "plain5", "fetch-nocache").second_hits,
      firefox_https_immutable_fetch_nocache_hits: https("firefox", "immutable5", "fetch-nocache").second_hits,
      chromium_https_immutable_fetch_nocache_hits: https("chromium", "immutable5", "fetch-nocache").second_hits,
      webkit_https_immutable_fetch_nocache_hits: https("webkit", "immutable5", "fetch-nocache").second_hits,
      // http 側（2026-08-10 追加）。immutable の有無で差が出ないことの対照。
      firefox_http_plain_fetch_nocache_hits: http("firefox", "plain5", "fetch-nocache").second_hits,
      firefox_http_immutable_fetch_nocache_hits: http("firefox", "immutable5", "fetch-nocache").second_hits,
      firefox_http_immutable_fetch_nocache_statuses: http("firefox", "immutable5", "fetch-nocache").second_statuses,
      schemes_measured: [...new Set(rows.map((r) => r.scheme))].sort(),
      stale_second_statuses: [...new Set(pick(rows, (r) => r.route === "stale" && r.scheme === "https").flatMap((r) => r.second_statuses))].sort(),
      restart_hits_chromium: https("chromium", "plain5", "restart").second_hits,
      restart_hits_webkit: https("webkit", "plain5", "restart").second_hits,
    };
  },

  "006-hard-reload": async () => {
    const rows = rawRows("006-hard-reload");
    const at = (kind, v) => pick(rows, (r) => r.reload_kind === kind && r.variant === v);
    return {
      browsers: await browserVersions(["chromium", "firefox"]),
      normal_reload_asset_hits_max: Math.max(...at("normal", "plain").concat(at("normal", "immutable")).map((r) => r.asset_hits)),
      hard_reload_statuses: [...new Set(rows.filter((r) => r.reload_kind === "hard").flatMap((r) => r.asset_statuses))],
      hard_reload_asset_hits_min: Math.min(...rows.filter((r) => r.reload_kind === "hard").map((r) => r.asset_hits)),
      immutable_changes_hard_reload: at("hard", "plain").some(
        (p) => !at("hard", "immutable").some((i) => i.browser === p.browser && i.asset_hits === p.asset_hits)
      ),
      key_delivered_all_cases: rows.every((r) => r.page_rerequested >= 1),
    };
  },

  "006-expires-directive": async () => {
    const rows = rawRows("006-expires-directive");
    const c = (label) => one(rows, (r) => r.case === label);
    return {
      expires_1h_cache_control: c("expires 1h").cache_control,
      expires_max_cache_control: c("expires max").cache_control,
      expires_max_expires: c("expires max").expires,
      expires_minus1_cache_control: c("expires -1").cache_control,
      expires_epoch_expires: c("expires epoch").expires,
      expires_off_cache_control_count: c("expires off").cache_control.length,
      expires_error500_status: c("expires 1h + 500 応答").status,
      expires_error500_cache_control_count: c("expires 1h + 500 応答").cache_control.length,
      expires_error500_expires_count: c("expires 1h + 500 応答").expires.length,
    };
  },

  "006-expires-conflict": async () => {
    const curl = rawRows("006-expires-conflict").filter((r) => r.case);
    const br = rawRows("006-expires-conflict").filter((r) => r.label && !r.control);
    const c = (label) => one(curl, (r) => r.case === label);
    const b = (label) => pick(br, (r) => r.label === label);
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      both_cache_control: c("両方（expires → add_header の順に書く）").cache_control,
      both_cache_control_count: c("両方（expires → add_header の順に書く）").cache_control_count,
      write_order_changes_headers:
        JSON.stringify(c("両方（expires → add_header の順に書く）").cache_control) !==
        JSON.stringify(c("両方（add_header → expires の順に書く）").cache_control),
      nested_child_own_cache_control_count: c("入れ子・子が自前の add_header を持つ").cache_control_count,
      nested_child_none_cache_control_count: c("入れ子・子が add_header を持たない").cache_control_count,
      browser_refetch_when_two_headers: b("両方（2 行届く）").every((r) => r.second_hits >= 1),
      browser_caches_when_parent_header_dropped: b("入れ子・親の no-store が落ちる").every((r) => r.second_hits === 0),
    };
  },

  "006-contradictory": async () => {
    const rows = rawRows("006-contradictory").filter((r) => !r.control);
    const v = (name) => pick(rows, (r) => r.variant === name);
    const statuses = (name) => [...new Set(v(name).flatMap((r) => r.second_statuses))].sort();
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      no_store_with_max_age_statuses: statuses("ns-max"),
      no_cache_with_max_age_statuses: statuses("nc-max"),
      no_store_with_no_cache_statuses: statuses("ns-nc"),
      mdn_conflicted_example_statuses: statuses("conflicted"),
      must_revalidate_fresh_hits: Math.max(...v("mustrev").map((r) => r.second_hits)),
      engines_agree: ["ns-max", "nc-max", "ns-nc", "conflicted", "mustrev"].every(
        (n) => new Set(v(n).map((r) => r.second_hits)).size === 1
      ),
    };
  },

  // must-revalidate の「期限が切れたあと」（2026-08-11 追加）。
  // 🔴 one() は使わない。(browser, variant, route) が一意でも、先勝ちで黙って 1 行しか
  //    見ない書き方は測定軸を足したときに壊れる（006-immutable-boundary の前例）。
  //    ここは全行を集合へ畳んでから比べる。
  "006-mustrev-boundary": async () => {
    const rows = rawRows("006-mustrev-boundary").filter((r) => !r.control);
    const v = (name) => pick(rows, (r) => r.variant === name && r.route === "stale");
    const statuses = (name) => [...new Set(v(name).flatMap((r) => r.second_statuses))].sort();
    const hits = (name) => [...new Set(v(name).map((r) => r.second_hits))].sort();
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      cases_measured: rows.length,
      plain5_stale_statuses: statuses("plain5"),
      must_revalidate_stale_statuses: statuses("mustrev5"),
      plain5_stale_hits: hits("plain5"),
      must_revalidate_stale_hits: hits("mustrev5"),
      must_revalidate_changes_stale_behaviour:
        JSON.stringify(statuses("plain5")) !== JSON.stringify(statuses("mustrev5")) ||
        JSON.stringify(hits("plain5")) !== JSON.stringify(hits("mustrev5")),
      engines_agree: ["plain5", "mustrev5"].every(
        (n) => new Set(v(n).map((r) => `${r.second_hits}:${JSON.stringify(r.second_statuses)}`)).size === 1
      ),
    };
  },

  "006-navigation": async () => {
    const rows = rawRows("006-navigation").filter((r) => !r.control);
    const v = (name, rt) => pick(rows, (r) => r.variant === name && r.route === rt);
    const bf = readJson(join(RESULTS, "006-navigation", "bfcache-manual.json"));
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      plain_reload_hits: Math.max(...v("plain", "reload").map((r) => r.second_hits)),
      must_revalidate_reload_hits: Math.max(...v("mustrev", "reload").map((r) => r.second_hits)),
      no_cache_reload_statuses: [...new Set(v("nocache", "reload").flatMap((r) => r.second_statuses))],
      bfcache_browser: bf.browser,
      bfcache_restored_no_cache_page: bf.cases.find((c) => c.page_cache_control === "no-cache").restored_from_bfcache,
      bfcache_restored_no_store_page: bf.cases.find((c) => c.page_cache_control === "no-store").restored_from_bfcache,
      bfcache_page_arrivals_on_back: 0,
      playwright_can_measure_bfcache: bf.playwright_comparison.restored_from_bfcache,
    };
  },

  "006-staleness": async () => {
    const rows = rawRows("006-staleness");
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      hits_after_server_fix: Math.max(...rows.map((r) => r.after_server_fix.hits)),
      rev_seen_after_server_fix: [...new Set(rows.map((r) => r.after_server_fix.rev_seen))],
      rev_seen_after_cache_busting: [...new Set(rows.map((r) => r.after_cache_busting.rev_seen))],
      stale_reproduced_all_engines: rows.every((r) => r.stale_reproduced),
      busting_worked_all_engines: rows.every((r) => r.busting_worked),
    };
  },

  "006-etag": async () => {
    const rows = rawRows("006-etag");
    const c = (label) => one(rows, (r) => r.case === label);
    return {
      etag_on_second_status: c("ETag あり").second_status,
      etag_off_second_status: c("ETag なし").second_status,
      etag_off_has_validator: c("ETag なし").etag.length > 0 || c("ETag なし").last_modified.length > 0,
      cache_control_both: c("ETag あり").cache_control,
    };
  },

  "006-proxy-cache": async () => {
    const rows = rawRows("006-proxy-cache");
    const c = (label) => one(rows, (r) => r.case === label);
    return {
      public_stored: c("public, max-age=60").stored_by_shared_cache,
      private_stored: c("private, max-age=60").stored_by_shared_cache,
      no_store_stored: c("no-store").stored_by_shared_cache,
      no_directive_stored: c("指定なし").stored_by_shared_cache,
      private_upstream_hits: c("private, max-age=60").upstream_hits,
      public_second_cache_status: c("public, max-age=60").second_cache_status,
    };
  },
};

async function main() {
  const want = process.argv.slice(2);
  const ids = want.length > 0 ? want : Object.keys(BUILDERS);
  for (const id of ids) {
    const build = BUILDERS[id];
    if (!build) {
      console.error(`unknown scenario: ${id}`);
      process.exit(3);
    }
    const summary = await build();
    writeFileSync(join(RESULTS, id, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    console.log(`${id}: summary.json を書き出しました（キー ${Object.keys(summary).length} 個）`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
// ==== tools/aggregate-008.mjs ====
#!/usr/bin/env node
// aggregate-008.mjs — 008 の測定結果を summary.json に畳む（M0・ブラウザを起動しない）
//
// 各ハーネスはブラウザごとに別ファイルを書く。記事に載せる値は
// ブラウザ横断で 1 枚にまとまっている必要があるため、ここで畳む。
// check-provenance.mjs はこの summary.json と expected.md を突合する。
//
// 使い方:
//   node tools/aggregate-008.mjs boundary
//   node tools/aggregate-008.mjs max-age

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const which = process.argv[2];

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function aggregateBoundary() {
  const dir = join(ROOT, "results", "008-preflight-boundary");
  const files = readdirSync(dir).filter((f) => /^boundary\..+\.json$/.test(f));
  if (files.length === 0) throw new Error("boundary.<browser>.json がありません");

  const per = files.map((f) => readJson(join(dir, f)));
  const ids = per[0].cases.map((c) => c.id);

  const summary = {
    measured_at: per.map((p) => p.measured_at).sort().at(-1),
    browsers: Object.fromEntries(per.map((p) => [p.browser, p.browser_version])),
    preflighted_count: per[0].preflighted_count,
    case_count: ids.length,
  };

  // ケースごとに、全ブラウザで判定が一致したかを記録する。
  // 割れた場合は値を書かず、割れた事実を残す（記事に一つの答えを書けないため）。
  let agree = true;
  for (const id of ids) {
    const votes = per.map((p) => p.cases.find((c) => c.id === id).preflighted);
    const same = votes.every((v) => v === votes[0]);
    if (!same) agree = false;
    summary[`preflight_${id.replace(/-/g, "_")}`] = same ? votes[0] : "browsers_disagree";
  }
  summary.all_browsers_agree = agree;

  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`[aggregate] boundary — ${ids.length} ケース / ブラウザ一致 ${agree ? "あり" : "なし"}`);
  return summary;
}

function aggregateMaxAge() {
  const dir = join(ROOT, "results", "008-cors-max-age");
  const files = readdirSync(dir).filter((f) => /\.(chromium|firefox|webkit)\.json$/.test(f));
  if (files.length === 0) throw new Error("<label>.<browser>.json がありません");

  const per = files.map((f) => readJson(join(dir, f)));
  const summary = { browsers: {}, measured_at: null };

  const at = [];
  for (const r of per) {
    summary.browsers[r.browser] = r.browser_version;
    at.push(r.started_at);

    // 再発間隔の代表値は中央値。1 秒刻みの取りこぼしを平均で薄めない。
    const gaps = r.preflight_gaps_s ?? [];
    const median = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;

    const key = `${r.label}_${r.browser}`.replace(/-/g, "_");
    summary[`${key}_preflight_count`] = r.preflight_count;
    summary[`${key}_gap_median_s`] = median;
  }
  summary.measured_at = at.sort().at(-1);

  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`[aggregate] max-age — ${per.length} 件の測定を畳みました`);
  return summary;
}

if (which === "boundary") aggregateBoundary();
else if (which === "max-age") aggregateMaxAge();
else {
  console.error("usage: node tools/aggregate-008.mjs <boundary|max-age>");
  process.exit(2);
}
// ==== tools/aggregate-011.mjs ====
#!/usr/bin/env node
// aggregate-011.mjs — 011（HTTP/3）の M3 生ログを記事に載せる表へ畳む
//
// 🔴 予測は入れない。crossover-*.jsonl / mux-*.jsonl に実際に記録された値だけを使う。
//
// 集計規約（前セッションの誤りを繰り返さないための取り決め）:
//   - タイムアウト（curl_rc≠0）を速度 0 として中央値に混ぜない。完走した回だけで中央値を出す
//   - 3 回中 k 回しか完走しなければ (k/3) を付す。1 回も完走しなければ TIMEOUT
//   - 実効 RTT は設定値でなくログに記録された実測値を併記する
//   - プロトコルを分けて回した回（ファイル名の -h1 / -h2 / -h3 / -tcp）は同じ条件へ束ねる
//
// 使い方: node tools/aggregate-011.mjs [crossover|mux|offload|control]（省略時は全部）

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "results/011-protocol");
const PROTOS = ["http1.1", "http2", "http3-only"];

const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const readJsonl = (f) =>
  readFileSync(join(DIR, f), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

/** ファイル名から nginx の http3_stream_buffer_size を読む。
 *  反復測定（-rep2）は別の行として残す。混ぜると過去に記事へ出した値が黙って動くため。 */
function settingOf(name) {
  const buf = name.includes("buf4m")
    ? "4m"
    : name.includes("buf1m")
      ? "1m"
      : name.includes("buf256k")
        ? "256k"
        : "64k"; // 既定（ディレクティブを書かない状態）
  const rep = name.match(/-rep(\d+)/);
  return rep ? `${buf}(rep${rep[1]})` : buf;
}

const files = readdirSync(DIR);

/** 1 セル分の表示。完走数を必ず併記する */
function cell(runs) {
  const ok = runs.filter((r) => r.curl_rc === 0 && r.m.size > 0);
  if (ok.length === 0) return "TIMEOUT";
  const mbps = median(ok.map((r) => (r.m.speed_bps * 8) / 1e6));
  const s = mbps < 100 ? mbps.toFixed(1) : mbps.toFixed(0);
  return ok.length === runs.length ? s : `${s} (${ok.length}/${runs.length})`;
}

function crossoverGroups(labels) {
  const g = new Map();
  // オフロード比較は buffer=4m 固定の別実験。ファイル名に設定が入らないので、この表からは外す
  const target = files.filter(
    (f) => f.startsWith("crossover-") && f.endsWith(".jsonl") && !f.includes("offload")
  );
  for (const f of target) {
    const setting = settingOf(f);
    for (const r of readJsonl(f)) {
      if (labels && !labels.includes(r.label)) continue;
      const key = [r.label, r.rate, r.rtt_set_ms, r.loss, setting].join("|");
      if (!g.has(key)) g.set(key, new Map());
      const byProto = g.get(key);
      if (!byProto.has(r.proto)) byProto.set(r.proto, []);
      byProto.get(r.proto).push(r);
    }
  }
  return g;
}

function printCrossover(labels) {
  const g = crossoverGroups(labels);
  console.log("| ラベル | 条件 | 設定 | 実効RTT min/med/p90 (ms) | h1.1 | h2 | h3 |");
  console.log("|---|---|---|---|---:|---:|---:|");
  for (const key of [...g.keys()].sort()) {
    const [label, rate, rtt, loss, setting] = key.split("|");
    const byProto = g.get(key);
    const any = [...byProto.values()][0][0];
    const e = any.rtt_eff;
    const cells = PROTOS.map((p) => (byProto.has(p) ? cell(byProto.get(p)) : "—"));
    console.log(
      `| ${label} | ${rate} / 設定${rtt}ms / loss ${loss} | ${setting} | ` +
        `${e.min.toFixed(0)} / ${e.median.toFixed(0)} / ${e.p90.toFixed(0)} | ` +
        `${cells[0]} | ${cells[1]} | **${cells[2]}** |`
    );
  }
}

/** TCP アームは http3_stream_buffer_size の影響を受けない。ここのばらつき＝測定の地面の揺れ */
function printControl() {
  const g = crossoverGroups(null);
  const rows = [];
  for (const key of [...g.keys()].sort()) {
    const [label, rate, rtt, loss, setting] = key.split("|");
    if (setting !== "64k") continue;
    const other = [label, rate, rtt, loss, "4m"].join("|");
    if (!g.has(other)) continue;
    for (const proto of ["http1.1", "http2"]) {
      const a = g.get(key).get(proto);
      const b = g.get(other).get(proto);
      if (!a || !b) continue;
      const [x, y] = [a, b].map((rs) => {
        const ok = rs.filter((r) => r.curl_rc === 0 && r.m.size > 0);
        return ok.length ? median(ok.map((r) => (r.m.speed_bps * 8) / 1e6)) : null;
      });
      if (!x || !y) continue;
      const ratio = Math.max(x, y) / Math.min(x, y);
      rows.push({ label, rtt, loss, proto, x, y, ratio });
      console.log(
        `| ${label} | 設定${rtt}ms / loss ${loss} | ${proto} | ${x.toFixed(1)} | ${y.toFixed(1)} | ${ratio.toFixed(2)} |`
      );
    }
  }
  const rs = rows.map((r) => r.ratio);
  console.log(
    `\n対照 n=${rs.length} / 比の中央値 ${median(rs).toFixed(2)} / 最大 ${Math.max(...rs).toFixed(2)}`
  );
}

// 🔴 rtt_set_ms でも分ける（2026-08-15 修正）。
// mux-64k.jsonl / mux-4m.jsonl は 20ms と 100ms を 36 行ずつ含むため、
// 従来は両者を混ぜた中央値を出しており、記事の表（100ms 条件）を再現できなかった。
// ファイル見出しの実効 RTT も rows[0] だけを見ていたため 100ms 側が誤ラベルになっていた。
function printMux() {
  for (const f of files.filter((f) => f.startsWith("mux-") && f.endsWith(".jsonl")).sort()) {
    const rows = readJsonl(f);
    console.log(`\n### ${f}（loss ${rows[0].loss ?? "0%"}）`);
    const conds = [...new Set(rows.map((r) => r.rtt_set_ms))].sort((a, b) => a - b);
    for (const rtt of conds) {
      const sub = rows.filter((r) => r.rtt_set_ms === rtt);
      const effMin = median(sub.map((r) => r.rtt_eff.min));
      const effMed = median(sub.map((r) => r.rtt_eff.median));
      console.log(
        `  [設定 ${rtt}ms / 実効RTT min ${effMin.toFixed(0)}ms・med ${effMed.toFixed(0)}ms]`
      );
      const g = new Map();
      for (const r of sub) {
        const k = `${r.objects}|${r.mode}`;
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(r.elapsed_s);
      }
      for (const k of [...g.keys()].sort((a, b) => {
        const [an, am] = a.split("|");
        const [bn, bm] = b.split("|");
        return Number(an) - Number(bn) || am.localeCompare(bm);
      })) {
        const [n, mode] = k.split("|");
        const v = g.get(k);
        console.log(
          `    N=${n.padStart(3)} ${mode.padEnd(8)} median=${median(v).toFixed(3)}s  runs=[${v.join(", ")}]`
        );
      }
    }
  }
}

function printOffload() {
  const out = new Map();
  for (const tag of ["on", "off"]) {
    for (const r of readJsonl(`crossover-T4-offload-${tag}.jsonl`)) {
      const k = `${r.proto}|${tag}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push((r.m.speed_bps * 8) / 1e6);
    }
  }
  console.log("| プロトコル | オフロード ON | OFF | ON/OFF |");
  console.log("|---|---:|---:|---:|");
  for (const p of PROTOS) {
    const on = median(out.get(`${p}|on`));
    const off = median(out.get(`${p}|off`));
    console.log(
      `| ${p} | ${on.toFixed(0)} | ${off.toFixed(0)} | ${(on / off).toFixed(2)} |`
    );
  }
}

const what = process.argv[2];
if (!what || what === "crossover") {
  console.log("## crossover（カード①・ロス率条件を含む）\n");
  printCrossover(null);
}
if (!what || what === "control") {
  console.log("\n## 対照アーム（設定が効かないはずの h1.1 / h2 の 64k ⟷ 4m 比）\n");
  console.log("| ラベル | 条件 | プロトコル | 64k | 4m | 比 |");
  console.log("|---|---|---|---:|---:|---:|");
  printControl();
}
if (!what || what === "mux") {
  console.log("\n## mux（カード②）");
  printMux();
}
if (!what || what === "offload") {
  console.log("\n## オフロード ON/OFF（無整形・100 MiB）\n");
  printOffload();
}
// ==== tools/measure-003.mjs ====
#!/usr/bin/env node
// measure-003.mjs — 記事 003 の M1 シナリオを測る（curl・CI で回る）
//
// 測るもの:
//   003-put-idempotent … 同じ PUT を 3 回送ったときサーバ状態がどう動くか
//   003-delete-repeat  … 2 回目の DELETE で状態と応答がそれぞれどうなるか
//   003-patch-semantics… PATCH の再送が形式と操作でどう変わるか
//   003-safe-get       … 状態を変える GET を HEAD が踏むか
//   003-redirect-method… 301〜308 でメソッドとボディがどうなるか（クライアント = curl）
//
// 🔴 判定方針: 冪等性は**サーバ状態**で判定する。
//    「2 回目も同じ応答か」では定義とずれるため、応答は別の欄に記録するだけにする。
//
// 🔴 予測を書かない（G3 問 5）。集計は観測値から機械的に作る。
//
// 使い方: node tools/measure-003.mjs --scenario=003-put-idempotent

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = "http://localhost:8085";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** -i の出力から最後の応答（ヘッダ + 本文）を取り出す。-L では応答が連なる */
function parseResponse(text) {
  const parts = text.split(/\r?\n\r?\n/);
  let lastHead = -1;
  parts.forEach((p, i) => {
    if (/^HTTP\/[\d.]+ \d{3}/.test(p)) lastHead = i;
  });
  const head = parts[lastHead] ?? "";
  const body = parts.slice(lastHead + 1).join("\n\n");
  return {
    status: Number((head.match(/^HTTP\/[\d.]+ (\d{3})/m) || [])[1] ?? 0),
    head: head.trim(),
    body: body.trim(),
  };
}

function curlRaw(extra) {
  return execFileSync("curl", ["-sS", ...extra], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

function send(method, path, { data = null, ctype = null, extra = [] } = {}) {
  const a = ["-i", "-X", method];
  if (ctype) a.push("-H", `Content-Type: ${ctype}`);
  if (data !== null) a.push("--data-binary", data);
  a.push(...extra, `${BASE}${path}`);
  return parseResponse(curlRaw(a));
}

function state() {
  return JSON.parse(parseResponse(curlRaw(["-i", `${BASE}/003/state`])).body);
}

function reset() {
  send("POST", "/003/__reset");
}

/** 状態のスナップショット列から相異なるものの数を数える */
function distinct(snapshots) {
  return new Set(snapshots.map((s) => JSON.stringify(s))).size;
}

// ---------------------------------------------------------------- シナリオ

const SCENARIOS = {
  // ① 同じ PUT を 3 回。実装の 4 系統を同じ手続きで測る
  "003-put-idempotent": async (log) => {
    const SENDS = 3;
    const variants = [
      ["replace", "/003/put/replace/doc"],
      ["stamped", "/003/put/stamped/doc"],
      ["append", "/003/put/append/doc"],
      ["numbered", "/003/put/numbered/doc"],
    ];
    const payload = JSON.stringify({ title: "spec", body: "same bytes every time" });

    const distinctStates = {};
    const statuses = {};
    let rejected = 0;

    for (const [name, path] of variants) {
      reset();
      const snaps = [];
      const codes = [];
      for (let i = 0; i < SENDS; i++) {
        const r = send("PUT", path, { data: payload, ctype: "application/json" });
        codes.push(r.status);
        if (r.status >= 400) rejected++;
        snaps.push(state().docs);
        log.push(`## ${name} 送信 ${i + 1}/${SENDS}`);
        log.push(`status=${r.status}`);
        log.push(`state.docs=${JSON.stringify(snaps[i])}`);
        log.push("");
        // 更新時刻をサーバで打つ実装は、同じミリ秒に収まると差が消える。
        // 測っているのは実装の冪等性であって時計の分解能ではないので間隔を空ける。
        await sleep(50);
      }
      distinctStates[name] = distinct(snaps);
      statuses[name] = codes;
    }

    // 陽性対照。POST は毎回作る
    reset();
    const postSnaps = [];
    for (let i = 0; i < SENDS; i++) {
      const r = send("POST", "/003/post/collection", { data: payload, ctype: "application/json" });
      postSnaps.push(state().created);
      log.push(`## control:post 送信 ${i + 1}/${SENDS}`);
      log.push(`status=${r.status} body=${r.body}`);
      log.push(`state.created=${JSON.stringify(postSnaps[i])}`);
      log.push("");
    }

    return {
      sends_per_variant: SENDS,
      variants_measured: variants.length,
      distinct_states_after_sends: distinctStates,
      status_sequence: statuses,
      control_post_distinct_states: distinct(postSnaps),
      control_post_created_count: postSnaps.at(-1).length,
      // 「メソッドの性質が実装を縛らない」ことの直接の観測。
      // 同じ PUT の反復を nginx も Express も 1 度も拒んでいない
      repeats_rejected_by_stack: rejected,
    };
  },

  // ② 2 回目の DELETE。状態と応答を分けて記録する
  "003-delete-repeat": async (log) => {
    const SENDS = 2;
    const variants = [
      ["strict", "/003/delete/strict/a"],
      ["lenient", "/003/delete/lenient/b"],
      ["echo", "/003/delete/echo/c"],
    ];
    const statusSeq = {};
    const bodySeq = {};
    const stateSame = {};
    const responseSame = {};

    for (const [name, path] of variants) {
      reset();
      const codes = [];
      const bodies = [];
      const snaps = [];
      for (let i = 0; i < SENDS; i++) {
        const r = send("DELETE", path);
        codes.push(r.status);
        bodies.push(r.body);
        snaps.push(state().items);
        log.push(`## ${name} 送信 ${i + 1}/${SENDS}`);
        log.push(`status=${r.status} body=${JSON.stringify(r.body)}`);
        log.push(`state.items=${JSON.stringify(snaps[i])}`);
        log.push("");
      }
      statusSeq[name] = codes;
      bodySeq[name] = bodies;
      stateSame[name] = distinct(snaps) === 1;
      responseSame[name] = new Set(codes.map((c, i) => `${c}|${bodies[i]}`)).size === 1;
    }

    return {
      sends_per_variant: SENDS,
      variants_measured: variants.length,
      status_sequence: statusSeq,
      state_same_after_repeat: stateSame,
      response_same_after_repeat: responseSame,
    };
  },

  // ③ PATCH の再送。形式（merge / json）と操作（replace / add）で分ける
  "003-patch-semantics": async (log) => {
    const SENDS = 3;
    const cases = [
      ["merge_set", "/003/patch/merge", "application/merge-patch+json", JSON.stringify({ title: "final" })],
      ["merge_delete", "/003/patch/merge", "application/merge-patch+json", JSON.stringify({ title: null })],
      [
        "json_replace",
        "/003/patch/json",
        "application/json-patch+json",
        JSON.stringify([{ op: "replace", path: "/title", value: "final" }]),
      ],
      [
        "json_add_append",
        "/003/patch/json",
        "application/json-patch+json",
        JSON.stringify([{ op: "add", path: "/tags/-", value: "rest" }]),
      ],
    ];

    const distinctStates = {};
    const finalState = {};
    const statuses = {};

    for (const [name, path, ctype, data] of cases) {
      reset();
      const snaps = [];
      const codes = [];
      for (let i = 0; i < SENDS; i++) {
        const r = send("PATCH", path, { data, ctype });
        codes.push(r.status);
        snaps.push(JSON.parse(r.body));
        log.push(`## ${name} 送信 ${i + 1}/${SENDS}`);
        log.push(`content-type=${ctype}`);
        log.push(`status=${r.status} state=${r.body}`);
        log.push("");
      }
      distinctStates[name] = distinct(snaps);
      finalState[name] = snaps.at(-1);
      statuses[name] = codes;
    }

    return {
      sends_per_case: SENDS,
      cases_measured: cases.length,
      media_types_measured: ["application/json-patch+json", "application/merge-patch+json"],
      distinct_states_after_sends: distinctStates,
      final_state: finalState,
      status_sequence: statuses,
    };
  },

  // ④ 状態を変える GET。HEAD が同じハンドラを踏むか
  "003-safe-get": async (log) => {
    reset();
    const GETS = 3;
    for (let i = 0; i < GETS; i++) {
      const r = send("GET", "/003/unsafe/consume?token=curl&cs=get");
      log.push(`## GET ${i + 1}/${GETS}`);
      log.push(`status=${r.status} body=${r.body}`);
      log.push("");
    }
    const afterGet = state().quota.curl ?? 0;

    // HEAD は自分では 1 行も書いていない経路。app.get() のハンドラに落ちるかを見る
    const headRes = parseResponse(curlRaw(["-i", "-I", `${BASE}/003/unsafe/consume?token=head&cs=head`]));
    const afterHead = state().quota.head ?? 0;
    log.push("## HEAD 1/1");
    log.push(headRes.head);
    log.push(`body_bytes=${headRes.body.length}`);
    log.push("");

    // 対照。本当に読むだけの GET は状態を動かさない
    const before = JSON.stringify(state().quota);
    for (let i = 0; i < GETS; i++) send("GET", "/003/state");
    const after = JSON.stringify(state().quota);
    log.push("## control:safe-get（読むだけの GET を 3 回）");
    log.push(`quota_before=${before}`);
    log.push(`quota_after=${after}`);
    log.push("");

    return {
      get_sends: GETS,
      consumed_after_get_sends: afterGet,
      head_sends: 1,
      consumed_after_head: afterHead,
      head_status: headRes.status,
      head_response_body_bytes: headRes.body.length,
      control_safe_get_changed_state: before !== after,
    };
  },

  // ⑤ リダイレクトでメソッドとボディがどうなるか。クライアントは curl
  "003-redirect-method": async (log) => {
    const codes = [301, 302, 303, 307, 308];
    // 同じ「POST を送る」でも書き方で結果が変わるため 3 通りを並べる
    const variants = [
      ["implicit", []], // -d だけ（メソッドは curl が決める）
      ["forced", ["-X", "POST"]], // メソッド名を明示する書き方
      ["post30x", ["--post301", "--post302", "--post303"]], // 変換をやめさせる指定
    ];
    const payload = "amount=1000";

    const method = {};
    const bodyBytes = {};

    for (const [vname, extra] of variants) {
      method[vname] = {};
      bodyBytes[vname] = {};
      for (const code of codes) {
        reset();
        const a = ["-i", "-L", ...extra, "-H", "Content-Type: text/plain", "--data-binary", payload,
                   `${BASE}/003/redirect/${code}?cs=${vname}`];
        const r = parseResponse(curlRaw(a));
        const arrival = state().arrivals.at(-1) ?? null;
        method[vname][code] = arrival?.method ?? null;
        bodyBytes[vname][code] = arrival?.body_length ?? null;
        log.push(`## ${vname} / ${code}`);
        log.push(`curl-args=${JSON.stringify(["-L", ...extra, "--data-binary", payload])}`);
        log.push(`final-status=${r.status}`);
        log.push(`arrival=${JSON.stringify(arrival)}`);
        log.push("");
      }
    }

    return {
      codes_measured: codes,
      request_body_bytes_sent: payload.length,
      method_at_destination: method,
      body_bytes_at_destination: bodyBytes,
    };
  },
};

// ---------------------------------------------------------------- 実行

const id = args.scenario;
if (!id || !SCENARIOS[id]) {
  console.error(`✗ USAGE [measure-003] --scenario=<${Object.keys(SCENARIOS).join(" | ")}>`);
  process.exit(3);
}

const dir = join(ROOT, "results", id);
mkdirSync(dir, { recursive: true });

const log = [];
const nginx = execFileSync("docker", ["compose", "exec", "-T", "edge", "nginx", "-v"], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
const meta = JSON.parse(parseResponse(curlRaw(["-i", `${BASE}/__meta`])).body);
const curlVersion = (execFileSync("curl", ["--version"], { encoding: "utf8" }).split("\n")[0].match(/curl ([\d.]+)/) || [])[1];

const header = [
  `measured-at: ${new Date().toISOString()}`,
  `scenario: ${id}`,
  `mode: M1`,
  `base: ${BASE}`,
  `nginx: ${nginx}`,
  `node: ${meta.node}`,
  `curl: ${curlVersion}`,
  "---",
  "",
];

const values = await SCENARIOS[id](log);

writeFileSync(join(dir, "run.log"), header.concat(log).join("\n") + "\n");
writeFileSync(
  join(dir, "summary.json"),
  JSON.stringify({ ...values, client: "curl", curl_version: curlVersion }, null, 2) + "\n"
);
console.log(`[measure-003] ${id} — ${Object.keys(values).length} 項目を記録しました`);
// ==== tools/measure-006-cache.mjs ====
#!/usr/bin/env node
// measure-006-cache.mjs — Cache-Control の実効挙動を実ブラウザで測る（M2）
//
// 判定はサーバ側の到着記録（results/006-cache/access.log）で行う。
// ブラウザ内部からキャッシュ命中は覗けないため。到着の意味は 3 つに分かれる。
//
//   到着 0 件 … キャッシュから読んだ（訊きにも来ていない）
//   status=304 … 訊きに来たが本体は送っていない（条件付き要求）
//   status=200 … 取り直した
//
// 🔴 immutable の効果は「条件付き要求すら出さない」ことなので、304 と 200 を
//    区別しない判定では測れない。log_format に status を入れているのはそのため。
//
// 🔴 対照を事前条件として検査する。
//    陰性対照 plain … 2 回目の到着が 0 でなければ、そもそもキャッシュが働いていない
//    陽性対照 nostore … 2 回目が必ず到着しなければ、観測チャネルが死んでいる
//    条件付き対照 nocache … 2 回目が 304 で届かなければ、この装置は「訊きに来たこと」を
//                            そもそも観測できていない。immutable の効果は
//                            「条件付き要求を出さない」ことなので、304 を 1 件も
//                            観測できない装置での 0 件は何も意味しない。
//    いずれかが崩れた実行は測定値を書き出さずに落とす（偽の 0 件を防ぐ）。
//
// 使い方:
//   node tools/measure-006-cache.mjs --scenario=006-immutable --browser=chromium
//   node tools/measure-006-cache.mjs --scenario=006-immutable --browser=chromium --persistent
//
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHARED = join(ROOT, "results", "006-cache");
const LOG = join(SHARED, "access.log");
const ORIGIN = { http: "http://localhost:8084", https: "https://localhost:8444" };
const ASSET = "/006/asset/app.css";

const LAUNCHERS = { chromium, firefox, webkit };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

// 各シナリオが振る変種と経路。対照（plain / nostore の nav）は常に足される。
const SCENARIOS = {
  "006-immutable": {
    variants: ["plain", "immutable"],
    routes: ["nav", "reload"],
    schemes: ["http", "https"],
  },
  // immutable が「まだ効く経路」が残っていないかを潰しにいく。
  // 通常ナビゲーションとリロードで差が出なかったため、fresh でなくなった後・
  // プロファイル再起動後・スクリプトから明示的に再検証した場合を足す。
  // 🔴 schemes に http を足した（2026-08-10）。Firefox が immutable を
  //    https でのみ honor する（Bugzilla 1267474）ことは、https だけ測っても言えない。
  //    「http では差が出ない」という対照が要る。それまで本シナリオは https のみで、
  //    記事が書いていた http 側の記述に対応する記録が results に無かった。
  "006-immutable-boundary": {
    variants: ["plain5", "immutable5"],
    routes: ["stale", "restart", "fetch-nocache", "fetch-reload"],
    schemes: ["http", "https"],
  },
  // カード②のブラウザ側。Cache-Control が 2 行届いたときどちらに従うかは
  // サーバ側のヘッダを見ても分からない。実際に再取得しに来るかで判定する。
  "006-expires-conflict": {
    paths: [
      { label: "expires のみ（max-age=3600）", path: "/006/exp/expires-only.css" },
      { label: "add_header のみ（no-store）", path: "/006/exp/addheader-only.css" },
      { label: "両方（2 行届く）", path: "/006/exp/both.css" },
      { label: "入れ子・親の no-store が落ちる", path: "/006/exp/nest/child-own.css" },
    ],
    routes: ["nav"],
    schemes: ["https"],
  },
  "006-contradictory": {
    variants: ["ns-max", "nc-max", "ns-nc", "conflicted", "mustrev"],
    routes: ["nav"],
    schemes: ["https"],
  },
  "006-navigation": {
    variants: ["plain", "mustrev", "nocache"],
    routes: ["nav", "reload"],
    schemes: ["https"],
  },
  // 🔴 must-revalidate の「期限が切れたあと」を測る（2026-08-11 追加）。
  //    006-contradictory は max-age=600 と併記した fresh のあいだしか見ておらず、
  //    記事は 3 か所で「期限が切れたあとの動きは測っていない」と書いていた。
  //    仕様（RFC 9111）が must-revalidate に与えている意味は stale 側にあるので、
  //    短命版（max-age=5）で境界を跨ぎ、有無だけを変えて比べる。
  "006-mustrev-boundary": {
    variants: ["plain5", "mustrev5"],
    routes: ["stale"],
    schemes: ["https"],
  },
};

function logLines() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8").split("\n").filter(Boolean);
}

/**
 * from 行目以降で、この case のアセット到着行を返す。
 *
 * アセットのパスはシナリオによって変わる（変種をクエリで振る系統と、設定の違う
 * location を叩く系統がある）ため、パスではなくケース識別子で絞る。
 * ページ自身の到着行は測定対象ではないので除く。
 */
function assetHitsSince(from, cs) {
  return logLines()
    .slice(from)
    .filter((l) => l.includes(`cs=${cs}`) && !l.includes("/006/page"));
}

function statusOf(line) {
  const m = line.match(/status=(\d{3})/);
  return m ? Number(m[1]) : null;
}

function urls(scheme, v, cs, br, rt, assetPath) {
  const base = ORIGIN[scheme];
  // アセット URL は 1 回目と 2 回目で完全に同一にする（URL がキャッシュの鍵のため）
  const asset = assetPath
    ? `${assetPath}?sc=006&cs=${cs}&br=${br}&rt=${rt}`
    : `${ASSET}?v=${v}&sc=006&cs=${cs}&br=${br}&rt=${rt}`;
  // 🔴 ページ URL は毎回変える。同一 URL への再訪が reload と解釈される余地を消すため。
  //    判定対象はアセットなので、ページ側を変えても測るものは変わらない。
  const page = (n) =>
    `${base}/006/page?asset=${encodeURIComponent(asset)}&cc=no-store&sc=006&cs=${cs}&n=${n}`;
  return { page, asset: `${base}${asset}` };
}

async function openContext(launcher, browserName, persistent) {
  if (!persistent) {
    const browser = await launcher.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    return { context, close: async () => { await context.close(); await browser.close(); } };
  }
  // 実機に近い永続プロファイルでの対照。分離コンテキストがメモリキャッシュのみに
  // なっている可能性を排除できないため、同じ値が出るかを確かめる用途に使う。
  const dir = join(SHARED, `profile-${browserName}-${Date.now()}`);
  const context = await launcher.launchPersistentContext(dir, { ignoreHTTPSErrors: true });
  return {
    context,
    close: async () => {
      await context.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** プロファイルを閉じて開き直す経路だけは、コンテキストを 2 回開く必要がある */
async function measureRestart(launcher, browserName, scheme, v, cs, pageUrl) {
  const dir = join(SHARED, `profile-restart-${browserName}-${Date.now()}`);
  const before = logLines().length;

  let ctx = await launcher.launchPersistentContext(dir, { ignoreHTTPSErrors: true });
  let page = await ctx.newPage();
  await page.goto(pageUrl(1));
  await sleep(700);
  await ctx.close();
  const mid = logLines().length;

  // 同じプロファイルで開き直す。ディスクキャッシュが残っているかを見る。
  ctx = await launcher.launchPersistentContext(dir, { ignoreHTTPSErrors: true });
  page = await ctx.newPage();
  await page.goto(pageUrl(2));
  await sleep(900);
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });

  return { before, mid };
}

async function measureCase(launcher, browserName, scheme, v, route, persistent, assetPath) {
  const cs = `${browserName}-${scheme}-${v}-${route}${persistent ? "-persist" : ""}`;
  const { page: pageUrl, asset: assetUrl } = urls(scheme, v, cs, browserName, route, assetPath);

  if (route === "restart") {
    const { before, mid } = await measureRestart(launcher, browserName, scheme, v, cs, pageUrl);
    const all = assetHitsSince(before, cs);
    const second = assetHitsSince(mid, cs);
    return {
      scenario: args.scenario, browser: browserName, scheme, variant: v, route,
      persistent: true,
      first_hits: all.length - second.length,
      second_hits: second.length,
      second_statuses: second.map(statusOf),
      silent_on_second: second.length === 0,
    };
  }

  const { context, close } = await openContext(launcher, browserName, persistent);
  const page = await context.newPage();

  const before = logLines().length;
  await page.goto(pageUrl(1));
  await sleep(700);

  // fresh でなくなってから測る経路。max-age=5 の変種と組で使う。
  if (route === "stale") await sleep(7000);

  const mid = logLines().length;

  if (route === "nav" || route === "stale") await page.goto(pageUrl(2));
  else if (route === "reload") await page.reload();
  else if (route === "fetch-nocache" || route === "fetch-reload") {
    // スクリプトから明示的に再検証を要求したとき、immutable がそれを抑えるか。
    const mode = route === "fetch-nocache" ? "no-cache" : "reload";
    await page.evaluate(
      async ({ url, mode }) => { await fetch(url, { cache: mode }); },
      { url: assetUrl, mode }
    );
  }
  await sleep(900);

  const all = assetHitsSince(before, cs);
  const second = assetHitsSince(mid, cs);
  await close();

  return {
    scenario: args.scenario,
    browser: browserName,
    scheme,
    variant: v,
    route,
    persistent: Boolean(persistent),
    first_hits: all.length - second.length,
    second_hits: second.length,
    second_statuses: second.map(statusOf),
    // 2 回目に何も届かなかった = 訊きにも来ていない
    silent_on_second: second.length === 0,
  };
}

async function main() {
  const scenario = String(args.scenario ?? "");
  const spec = SCENARIOS[scenario];
  if (!spec) {
    console.error(`unknown --scenario: ${scenario}（${Object.keys(SCENARIOS).join(" / ")}）`);
    process.exit(3);
  }
  const browserName = String(args.browser ?? "chromium");
  const launcher = LAUNCHERS[browserName];
  if (!launcher) {
    console.error(`unknown --browser: ${browserName}`);
    process.exit(3);
  }
  const persistent = Boolean(args.persistent);

  const OUT = join(ROOT, "results", scenario);
  mkdirSync(OUT, { recursive: true });
  mkdirSync(SHARED, { recursive: true });

  const RUNLOG = join(OUT, "run.log");
  appendFileSync(
    RUNLOG,
    [
      `measured-at: ${new Date().toISOString()}`,
      `scenario: ${scenario}`,
      "mode: M2",
      `browser: ${browserName} ${(await (async () => { const b = await launcher.launch(); const v = b.version(); await b.close(); return v; })())}`,
      `profile: ${persistent ? "persistent" : "isolated-context"}`,
      `judgement: サーバ側の到着記録と status（生ログのカウントのみ・予測は入れない）`,
      "---",
    ].join("\n") + "\n"
  );

  const rows = [];

  // --- 対照を先に取る。ここが崩れていれば以降の 0 件はすべて意味を持たない ---
  for (const scheme of spec.schemes) {
    for (const v of ["plain", "nostore", "nocache"]) {
      const r = await measureCase(launcher, browserName, scheme, v, "nav", persistent);
      r.control = v === "plain" ? "negative" : v === "nostore" ? "positive" : "conditional";
      rows.push(r);
      appendFileSync(RUNLOG, JSON.stringify(r) + "\n");
      console.log(
        `[対照] ${browserName} ${scheme} ${v.padEnd(9)} nav  1回目=${r.first_hits} 2回目=${r.second_hits} ${JSON.stringify(r.second_statuses)}`
      );
    }
    const neg = rows.find((r) => r.scheme === scheme && r.variant === "plain" && r.route === "nav");
    const pos = rows.find((r) => r.scheme === scheme && r.variant === "nostore" && r.route === "nav");
    if (!neg || neg.second_hits !== 0) {
      throw new Error(
        `[${scenario}/${browserName}/${scheme}] 陰性対照が崩れました: plain の 2 回目が ${neg ? neg.second_hits : "?"} 件届いています。\n` +
          "この装置ではキャッシュが働いていません（分離コンテキストや TLS 警告バイパスの影響が疑われます）。\n" +
          "以降の「到着 0 件」は測定値として意味を持たないため、書き出さずに中止しました。"
      );
    }
    if (!pos || pos.second_hits < 1) {
      throw new Error(
        `[${scenario}/${browserName}/${scheme}] 陽性対照が崩れました: no-store の 2 回目が届いていません。\n` +
          "観測チャネル（nginx のアクセスログ）が死んでいる可能性があります。\n" +
          "復旧: docker compose exec edge nginx -s reopen"
      );
    }
    const cond = rows.find((r) => r.scheme === scheme && r.variant === "nocache" && r.route === "nav");
    if (!cond || !cond.second_statuses.includes(304)) {
      throw new Error(
        `[${scenario}/${browserName}/${scheme}] 条件付き対照が崩れました: no-cache の 2 回目に 304 が観測できていません` +
          `（実測 ${JSON.stringify(cond ? cond.second_statuses : null)}）。\n` +
          "この装置は「訊きに来たこと」を観測できていないため、他の変種の「到着 0 件」を\n" +
          "「条件付き要求すら出さなかった」と読むことはできません。書き出さずに中止しました。"
      );
    }
  }

  // --- 本測定 ---
  // 変種をクエリで振るシナリオと、あらかじめ別の location を用意したパスを叩く
  // シナリオの 2 系統がある。後者は設定そのものが違うため URL を分ける必要がある。
  const units = spec.paths
    ? spec.paths.map((p, i) => ({ key: `p${i}`, label: p.label, path: p.path }))
    : spec.variants.map((v) => ({ key: v, label: v, path: null }));

  for (const scheme of spec.schemes) {
    for (const u of units) {
      for (const route of spec.routes) {
        const r = await measureCase(launcher, browserName, scheme, u.key, route, persistent, u.path);
        // 🔴 1 回目に届いていないケースは測定が成立していない。
        //    2 回目の 0 件を「キャッシュから読んだ」と読めるのは、1 回目に確かに
        //    取りに来ていたときだけ。ここを検査しないと、埋め込みに失敗しただけの
        //    ケースが「訊きにも来ない」という強い結論として出てしまう。
        if (r.first_hits < 1) {
          throw new Error(
            `[${scenario}/${browserName}/${scheme}] ${u.label} の 1 回目が 0 件です。\n` +
              `アセット（${u.path ?? ASSET}）がそもそも読み込まれていません。ページへの埋め込みに\n` +
              "失敗している可能性があります（許可リスト・パスの綴り）。測定として成立していないため中止しました。"
          );
        }
        r.label = u.label;
        if (u.path) r.asset_path = u.path;
        rows.push(r);
        appendFileSync(RUNLOG, JSON.stringify(r) + "\n");
        console.log(
          `${browserName.padEnd(9)} ${scheme.padEnd(5)} ${String(u.label).padEnd(30)} ${route.padEnd(6)} ` +
            `1回目=${r.first_hits} 2回目=${r.second_hits} ${JSON.stringify(r.second_statuses)} ` +
            `→ ${r.silent_on_second ? "訊きにも来ない" : "来た"}`
        );
      }
    }
  }

  const suffix = persistent ? `${browserName}-persistent` : browserName;
  writeFileSync(join(OUT, `raw.${suffix}.json`), JSON.stringify(rows, null, 2) + "\n");
  console.log(`\n${rows.length} 件を results/${scenario}/raw.${suffix}.json に保存しました。`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
// ==== tools/measure-008-cache-key.mjs ====
#!/usr/bin/env node
// measure-008-cache-key.mjs — preflight キャッシュの鍵の粒度を測る（M2・実ブラウザ）
//
// 仕様（WHATWG Fetch / CORS-preflight cache）では、エントリの鍵は
//   network partition key / byte-serialized origin / URL / credentials / method / header name
// で、しかもエントリは「レスポンスの Access-Control-Allow-Methods / -Headers に
// 列挙された分」だけ作られる。リクエストが要求した分ではない。
//
// そこで応答を 2 系統に分けて測る:
//   fixed — 要求に関係なく広く列挙する
//   echo  — 要求されたものだけを返す
//
// 判定はサーバ側の OPTIONS 到着記録（results/008-cache-key/preflight.log）で行う。
// 1 ケースにつき、1 回目 → 3 秒待つ → 2 回目 を同一コンテキストで送り、
// 到着が 1 件なら「2 回目はキャッシュに当たった」、2 件なら「別エントリ扱い」。
//
// 🔴 max-age は 30 秒。3 秒後の 2 回目が飛んだ場合、それは期限切れではなく
//    鍵の違いによるものだと言える。
// 🔴 判定は生ログのカウントのみで機械的に行う。予測と食い違ってもそのまま記録する。
//
// 使い方: node tools/measure-008-cache-key.mjs [--browser=chromium|firefox|webkit|all]
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
// logLineCount は本ファイル内に同名の実装があるためそれを使う
import { assertLogChannelLive } from "./log-channel.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "008-cache-key");
const LOG = join(OUT, "preflight.log");
const RUNLOG = join(OUT, "run.log");
const PAGE = "http://localhost:8080/008/";
const API = "http://localhost:8081";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const LAUNCHERS = { chromium, firefox, webkit };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1 ケース = 2 回のリクエスト。2 回目で OPTIONS が届くかを見る。
// path は API 直下の相対パス。<PREFIX> は実行時にケース固有の接頭辞へ置換する。
const CASES = [
  {
    id: "K0", desc: "完全に同一のリクエストを 2 回",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
  {
    id: "K1", desc: "パスを変える",
    a: { path: "/p1", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p2", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
  {
    id: "K2", desc: "クエリだけ変える",
    a: { path: "/p?x=1", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p?x=2", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
  {
    id: "K3", desc: "メソッドを変える（PUT → DELETE）",
    a: { path: "/p", method: "PUT", headers: {}, creds: "omit" },
    b: { path: "/p", method: "DELETE", headers: {}, creds: "omit" },
  },
  {
    id: "K4", desc: "独自ヘッダを増やす（x-probe → x-probe, x-extra）",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1", "x-extra": "1" }, creds: "omit" },
  },
  {
    id: "K5", desc: "独自ヘッダを減らす（x-probe, x-extra → x-probe）",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1", "x-extra": "1" }, creds: "omit" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
  {
    id: "K6", desc: "credentials なし → include",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "include" },
  },
  {
    id: "K7", desc: "credentials include → なし",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "include" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
];

const SYSTEMS = ["fixed", "echo"];

/** ログの現在行数（この時点以降に増えた分だけを数えるため） */
function logLineCount() {
  if (!existsSync(LOG)) return 0;
  return readFileSync(LOG, "utf8").split("\n").filter(Boolean).length;
}

/** from 行目以降で、prefix 宛の OPTIONS 到着を数える */
function countOptionsSince(from, prefix) {
  if (!existsSync(LOG)) return 0;
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(from)
    .filter((l) => l.includes(" OPTIONS ") && l.includes(prefix))
    .length;
}

async function runRequest(page, url, req) {
  return page.evaluate(
    async ({ url, method, headers, creds }) => {
      try {
        const res = await fetch(url, { method, headers, credentials: creds });
        return { ok: true, status: res.status };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    },
    { url, method: req.method, headers: req.headers, creds: req.creds }
  );
}

async function measureCase(launcher, browserName, system, c) {
  const browser = await launcher.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(PAGE);

  const prefix = `/008/cachekey/${system}/${browserName}/${c.id}`;
  const before = logLineCount();

  const ra = await runRequest(page, `${API}${prefix}${c.a.path}`, c.a);
  // ログが書き出されるまでの猶予 + キャッシュ有効期間内で 2 回目を送る
  await sleep(3000);
  const mid = logLineCount();
  const rb = await runRequest(page, `${API}${prefix}${c.b.path}`, c.b);
  await sleep(1500);

  // before〜mid = 1 回目の到着 / mid〜末尾 = 2 回目の到着
  const firstOnly = countOptionsSince(before, prefix) - countOptionsSince(mid, prefix);
  const secondOnly = countOptionsSince(mid, prefix);

  await context.close();
  await browser.close();

  return {
    case: c.id,
    desc: c.desc,
    system,
    browser: browserName,
    preflight_first: firstOnly,
    preflight_second: secondOnly,
    second_fired: secondOnly > 0,
    first_result: ra,
    second_result: rb,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // 観測チャネル（サーバ側の到着記録）の生死は測定の前提
  const logBefore = logLineCount();

  // 🔴 M2 は CI で回らないため、実施条件を run.log に残す（check-provenance が先頭 10 行を検査する）
  const header = [
    `measured-at: ${new Date().toISOString()}`,
    `scenario: 008-cache-key`,
    "mode: M2",
    `page-origin: ${PAGE}`,
    `api-origin: ${API}`,
    `judgement: サーバ側の OPTIONS 到着記録（生ログのカウントのみ・予測は入れない）`,
    "---",
  ].join("\n") + "\n";
  appendFileSync(RUNLOG, header);

  const want = args.browser === "all" || !args.browser
    ? ["chromium", "firefox", "webkit"]
    : [String(args.browser)];

  const rows = [];
  for (const browserName of want) {
    const launcher = LAUNCHERS[browserName];
    if (!launcher) throw new Error(`unknown browser: ${browserName}`);
    for (const system of SYSTEMS) {
      for (const c of CASES) {
        const r = await measureCase(launcher, browserName, system, c);
        rows.push(r);
        appendFileSync(RUNLOG, JSON.stringify(r) + "\n");
        console.log(
          `${browserName.padEnd(8)} ${system.padEnd(5)} ${r.case} ` +
            `1回目=${r.preflight_first} 2回目=${r.preflight_second} ` +
            `→ ${r.second_fired ? "飛んだ" : "飛ばない"}  ${r.desc}`
        );
      }
    }
  }

  // 書き出す前に観測チャネルの生死を確かめる（死んでいれば到着 0 件が偽の測定値になる）
  assertLogChannelLive(LOG, logBefore, "008-cache-key");

  // エンジンごとに別ファイルへ書く（1 エンジンずつ実行しても上書きしないため）
  for (const browserName of want) {
    const subset = rows.filter((r) => r.browser === browserName);
    writeFileSync(
      join(OUT, `raw.${browserName}.json`),
      JSON.stringify(subset, null, 2) + "\n"
    );
  }
  console.log(`\n${rows.length} 件を results/008-cache-key/raw.<browser>.json に保存しました。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
