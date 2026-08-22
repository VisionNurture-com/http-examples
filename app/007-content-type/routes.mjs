// 007 — Content-Type とボディ表現
//
// 観測対象は 2 つ。
//   ① 受信側: 型が合わないボディを送ったとき、Express は何を返すか（415 を返すのか）
//   ② 送信側: 型を偽って配ったとき、destination ごとにブラウザは何を止めるのか
//
// 🔴 先回りで 415 を返す実装を足さない。既定の挙動をそのまま測る。
//    自分で検査を書いた場合との差は /007/echo-strict を対照として並べて示す。
//
// 🔴 destination で挙動が割れることが観測の中心。
//    nosniff によるブロックは仕様上 script-like と "style" にしか適用されない
//    （Fetch Standard §3.6.1）。document ナビゲーションは対照として置く。
import express from "express";
import { SELFTEST_HTML } from "./selftest.mjs";

/** 型を偽って配る素材。kind ごとに中身を変え、実行されたかを window.__flags で拾う */
function assetBody(kind, flag) {
  switch (kind) {
    case "js":
      return `window.__flags = window.__flags || {}; window.__flags[${JSON.stringify(flag)}] = true;`;
    case "css":
      return `:root { --probe-${flag}: 1; }`;
    case "worker":
      // worker は window を持たない。読み込めたことだけを親へ返す
      return `postMessage(${JSON.stringify(flag)});`;
    case "doc":
      return "<b>bold</b>";
    default:
      return "";
  }
}

export function register(app) {
  // ---------------------------------------------------------------
  // ① 受信側 — 型が合わないボディ
  // ---------------------------------------------------------------

  // 既定の express.json()。type は既定値（application/json）のまま触らない
  app.post("/007/echo", express.json(), (req, res) => {
    res.json({ received: req.body ?? null, contentType: req.headers["content-type"] ?? null });
  });

  // 対照: 受信側で自分で検査を書いた場合。記事の結論（自分で 415 を出すしかない）の実物
  app.post("/007/echo-strict", express.json(), (req, res) => {
    const ct = req.headers["content-type"] ?? "";
    if (!/^application\/json\s*(;|$)/i.test(ct)) {
      // RFC 9110 §15.5.16: 415 のときは Accept で受理可能な型を示せる
      res.set("Accept", "application/json");
      return res.status(415).json({ error: "unsupported media type", got: ct || null });
    }
    res.json({ received: req.body ?? null, contentType: ct });
  });

  // 観測: 型が合わなかったとき req.body に「何が」入っているか。
  //
  // 🔴 /007/echo は `req.body ?? null` と書いているため、空オブジェクトと未定義が
  //    応答上では区別できるものの、集計側が真偽値へ丸めてしまう。express 5 系は
  //    型が合わないと req.body を **設定しない**（4 系は最低でも {} を保証していた・
  //    expressjs/express#6432）。読者のコードが落ちるかどうかを分けるのはこの差なので、
  //    typeof をそのまま返して測れるようにする。
  app.post("/007/echo-typed", express.json(), (req, res) => {
    res.json({
      bodyType: typeof req.body,
      bodyIsUndefined: req.body === undefined,
      contentType: req.headers["content-type"] ?? null,
    });
  });

  // 対照: 読者が素直に書いた場合。req.body のプロパティへ直接さわる。
  // 型が合っていれば 200、合っていなければ未定義参照で例外になる。
  // 🔴 先回りの防御を書かないことが観測の目的。?? や ?. を足さない。
  app.post("/007/echo-naive", express.json(), (req, res) => {
    res.json({ name: req.body.name });
  });

  // /007/echo-naive の例外を、握りつぶさずステータスと型名で観測できる形にする
  app.use("/007/echo-naive", (err, req, res, _next) => {
    res.status(500).json({ error: err.constructor.name, message: err.message });
  });

  // ---------------------------------------------------------------
  // ② 送信側 — 型を偽って配る
  // ---------------------------------------------------------------

  // /007/asset?kind=js|css|worker|doc&ct=<media type>&nosniff=1&flag=<name>
  app.get("/007/asset", (req, res) => {
    const kind = String(req.query.kind ?? "js");
    const flag = String(req.query.flag ?? "x").replace(/[^a-zA-Z0-9_-]/g, "");
    const ct = String(req.query.ct ?? "text/plain");
    res.set("Content-Type", ct);
    if (req.query.nosniff === "1") res.set("X-Content-Type-Options", "nosniff");
    res.send(assetBody(kind, flag));
  });

  // 対照（足場から維持）: text/plain で HTML 本文を返すドキュメントナビゲーション。
  // 仕様上 text/plain は HTML へ sniff されないため、nosniff の有無で差は出ないはず
  app.get("/007/text-as-html", (_req, res) => {
    res.set("Content-Type", "text/plain");
    res.send("<b>bold</b>");
  });
  app.get("/007/text-as-html-nosniff", (_req, res) => {
    res.set("Content-Type", "text/plain");
    res.set("X-Content-Type-Options", "nosniff");
    res.send("<b>bold</b>");
  });

  // ---------------------------------------------------------------
  // ③ 実ブラウザからの報告受け口（M2・Playwright 同梱版ではない本物で測る）
  // ---------------------------------------------------------------
  //
  // 🔴 Playwright 1.62.1 が同梱する Firefox は 153.0 で、stable の 154.0 より
  //    メジャーが 1 つ古い。中心的な発見（classic worker の MIME 検査）の対照が
  //    現行版を指さなくなるため、実ブラウザでも測る。
  //    Chrome は Playwright の channel:"chrome" で自動化できるが、Firefox と Safari は
  //    Playwright から本物を駆動できないため、ページ側から結果を POST させて拾う。
  //
  // 結果はプロセス内に保持するだけ（ファイルにも DB にも書かない）。ホスト側の
  // ハーネスが GET で回収して results/ へ落とす。
  const reports = [];

  app.post("/007/report", express.json({ limit: "256kb" }), (req, res) => {
    reports.push({ ua: req.headers["user-agent"] ?? null, at: new Date().toISOString(), data: req.body });
    res.json({ ok: true, count: reports.length });
  });
  app.get("/007/report", (_req, res) => res.json(reports));
  app.delete("/007/report", (_req, res) => {
    reports.length = 0;
    res.json({ ok: true, count: 0 });
  });

  // 実ブラウザで開くと全ケースを自動実行し、結果を /007/report へ送るページ
  app.get("/007/selftest", (_req, res) => {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(SELFTEST_HTML);
  });

  // M2 の測定ページ。同一オリジンから素材を読み、実行されたかを window.__flags で拾う
  app.get("/007/probe", (_req, res) => {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<meta charset="utf-8">
<title>007 probe</title>
<body>
<p id="marker">007 probe</p>
<script>window.__flags = {}; window.__errors = [];
window.addEventListener("error", (e) => { __errors.push(String(e.message || e.type)); }, true);</script>
</body>`);
  });
}
