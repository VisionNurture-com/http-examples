// 002 — リクエストを最小で再現する
//
// 🔴 観測対象: ヘッダを削ったとき、結果が変わったのが「どの層」かを分ける。
//    Express が実際に受け取ったヘッダをそのまま返すことで、nginx が何を転送したかも読める。
//
// 🔴 body は express.json() ではなく express.raw() で受ける。
//    「Content-Type が不一致のとき Express がどうパースするか」は 007 の観測対象であり、
//    002 が測るのは「何が届いたか」。パーサを挟むと 007 のカードを測り直すことになる。

import express from "express";
import { createHash } from "node:crypto";

export function register(app) {
  // 受け取ったものをそのまま返す。nginx 経由と直結の差もこれで読める。
  app.all("/002/api/echo", express.raw({ type: "*/*", limit: "10mb" }), (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.json({
      method: req.method,
      httpVersion: req.httpVersion,
      // 受信ヘッダの「集合」と「並び」の両方を出す。並びが結果を変えるかを測るため
      headers: req.headers,
      rawHeaderOrder: req.rawHeaders.filter((_, i) => i % 2 === 0),
      bodyBytes: body.length,
      bodySha256: createHash("sha256").update(body).digest("hex"),
    });
  });

  // 経路 B（nginx→Express）で「静的 GET」の対照を取るための固定応答。
  // 内容は public/002/sample.html と同じ性質（固定・毎回同じバイト列）にする。
  app.get("/002/api/static", (_req, res) => {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(STATIC_BODY);
  });
}

const STATIC_BODY = [
  "<!doctype html>",
  '<html lang="ja"><head><meta charset="utf-8" /><title>002 sample (app)</title></head>',
  "<body><h1>002 sample page (app)</h1>",
  "<p>これは Express 側が返す固定ページです。nginx 単独の経路（/002/static/）と対にして、",
  "削ったヘッダがどの層で効いたかを分けるために置いています。内容は固定で、生成しません。</p>",
  "<p>gzip の下限を超える大きさが要るため、意味のある文章で埋めています。小さすぎると",
  "圧縮されず、Accept-Encoding を削っても差が出ないため「削っても変わらない」という",
  "誤った分類になります。</p>",
  "</body></html>",
].join("\n");
