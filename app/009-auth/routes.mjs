// 009 — 認証と認可（Authorization が届く経路 / 届かない経路）
//
// 観測対象:
//   カード① オリジンの境界はどこで切れるか（パス差 / ポート差 / ホスト差 / スキーム差 / 復帰）
//   カード② 既定で Authorization を落とす構成はどれか（本ファイルは対照の「Express 直」を担う）
//
// 🔴 方針: Authorization は「あるか / ないか」と「スキーム名」だけを記録する。
//    値そのものはログにもレスポンスにも出さない（008-redirect と同じ規律）。
//
// 🔴 preflight（OPTIONS）は資格情報を載せずに飛ぶ。本番リクエストと数え違えると
//    結果が壊れるため、到着記録にはメソッドを必ず含める。
//
// 🔴 再実行で到着記録が累積するとカウントが重複する。
//    シナリオの先頭で POST /009/api/__reset を叩く。

import express from "express";

// --- オリジンの定義 -------------------------------------------------------
//
// 🔴 ここに書くのは **ホスト側のポート**。リダイレクト先の絶対 URL は
//    ブラウザと curl（= ホスト上で動く）が解決するため、コンテナ内のポートでは届かない。
//    対応は compose.yaml の ports を正本とする。
const ORIGIN_A = "http://localhost:8080"; // 基準のオリジン（edge :80）
const ORIGIN_PORT = "http://localhost:8091"; // ポートだけ違う（edge :91）
const ORIGIN_HOST = "http://127.0.0.1:8080"; // ホストだけ違う（同じ edge :80）
const ORIGIN_TLS = "https://localhost:8443"; // スキームが違う（edge :443・ポートも変わる）
// 🔴 サブドメイン。Go の net/http は「最初のドメインと exact match または subdomain match」
//    のときだけ資格情報を転送すると規定しており（Client.Do）、ホスト差とは別に測る必要がある。
//    *.localhost は RFC 6761 でループバックに解決されるため /etc/hosts を編集しなくてよい。
//    ⚠️ 解決は環境依存なので M2（手動）でのみ使い、CI で走る M1 には入れない。
const ORIGIN_SUBDOMAIN = "http://sub.localhost:8080"; // サブドメイン（同じ edge :80）

function initialState() {
  return { seq: 0, arrivals: [] };
}

let state = initialState();

// 実ブラウザからの自己申告。到着記録（state）とは別に持つ
let reports = [];

/** Authorization の中身は残さない。あるか / ないかと、スキーム名だけを取る。 */
function authShape(req) {
  const raw = req.headers.authorization;
  if (!raw) return { auth: "no", scheme: null };
  const scheme = String(raw).split(" ")[0] || "";
  return { auth: "yes", scheme };
}

function record(req) {
  const { auth, scheme } = authShape(req);
  state.seq += 1;
  state.arrivals.push({
    seq: state.seq,
    method: req.method,
    host: req.headers.host ?? null,
    path: req.originalUrl,
    auth,
    scheme,
    origin: req.headers.origin ?? null,
  });
}

export function register(app) {
  // --- CORS を完全に許可する（測定から CORS の失敗を取り除く）--------------
  //
  // 🔴 Access-Control-Allow-Headers: * は Authorization を覆わない
  //    （008-wildcard-auth で実測済み）。明示的に列挙する。
  // 🔴 Access-Control-Max-Age: 0 で preflight キャッシュを無効にする。
  //    ケース間で前の結果が残ると、到着記録が実態とずれる。
  app.use("/009", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Headers", "Authorization, X-Probe");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Expose-Headers", "X-Arrival-Auth");
    res.set("Access-Control-Max-Age", "0");
    if (req.method === "OPTIONS") {
      record(req);
      return res.status(204).end();
    }
    next();
  });

  // --- 測定の前提を整える口 ------------------------------------------------
  app.post("/009/api/__reset", (_req, res) => {
    state = initialState();
    res.status(204).end();
  });

  app.get("/009/api/arrivals", (_req, res) => res.json(state));

  // --- 実ブラウザの自己申告を受ける口（007 と同じ方式）--------------------
  //
  // 🔴 Playwright が同梱するブラウザは実ブラウザの代理にならない（MEASURE-01 Step 1b）。
  //    Firefox / Safari は Playwright から本物を駆動できないため、
  //    /009-page/selftest.html を開かせ、ページ自身に結果を POST させる。
  app.post("/009/report", express.json({ limit: "256kb" }), (req, res) => {
    reports.push({ at: new Date().toISOString(), ua: req.headers["user-agent"] ?? null, body: req.body ?? null });
    res.status(204).end();
  });

  app.get("/009/report", (_req, res) => res.json({ count: reports.length, reports }));

  app.post("/009/report/__reset", (_req, res) => {
    reports = [];
    res.status(204).end();
  });

  // --- 終端（ここへ何が届いたかがすべて）----------------------------------
  app.get("/009/whoami", (req, res) => {
    record(req);
    const { auth, scheme } = authShape(req);
    res.set("X-Arrival-Auth", auth);
    res.json({ auth, scheme, host: req.headers.host ?? null });
  });

  // --- カード①: オリジンの境界 -------------------------------------------
  //
  // B0（対照）は /009/whoami を直接叩くためリダイレクトの口を持たない。

  // B1 同一オリジン内のパス差
  app.get("/009/redirect/same", (req, res) => {
    record(req);
    res.redirect(302, `${ORIGIN_A}/009/whoami`);
  });

  // B2 ポートだけ違う
  app.get("/009/redirect/port", (req, res) => {
    record(req);
    res.redirect(302, `${ORIGIN_PORT}/009/whoami`);
  });

  // B3 ホストだけ違う（localhost → 127.0.0.1）
  app.get("/009/redirect/host", (req, res) => {
    record(req);
    res.redirect(302, `${ORIGIN_HOST}/009/whoami`);
  });

  // B4 スキームが違う（http → https。🔴 ポートも変わるため単独では分離できない）
  app.get("/009/redirect/scheme", (req, res) => {
    record(req);
    res.redirect(302, `${ORIGIN_TLS}/009/whoami`);
  });

  // B5 元のオリジンへ復帰（A → B → A）
  app.get("/009/redirect/back", (req, res) => {
    record(req);
    res.redirect(302, `${ORIGIN_PORT}/009/redirect/back-hop2`);
  });
  app.get("/009/redirect/back-hop2", (req, res) => {
    record(req);
    res.redirect(302, `${ORIGIN_A}/009/whoami`);
  });

  // B7 サブドメイン（localhost → sub.localhost・ポートは同じ）
  app.get("/009/redirect/subdomain", (req, res) => {
    record(req);
    res.redirect(302, `${ORIGIN_SUBDOMAIN}/009/whoami`);
  });

  // B6 同一オリジン内 → 別オリジン（A1 → A2 → B）
  app.get("/009/redirect/same-then-cross", (req, res) => {
    record(req);
    res.redirect(302, `${ORIGIN_A}/009/redirect/cross-hop2`);
  });
  app.get("/009/redirect/cross-hop2", (req, res) => {
    record(req);
    res.redirect(302, `${ORIGIN_PORT}/009/whoami`);
  });
}
