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
