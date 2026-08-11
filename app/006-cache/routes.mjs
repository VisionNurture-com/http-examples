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
