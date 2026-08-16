// 012-compression/routes.mjs — 記事 012 の観測対象（103 Early Hints と、サーバの実処理時間）
//
// 🔴 ここで測りたいのは「報告される TTFB」と「サーバが実際に費やした時間」の差。
//    そのため 2 つを別々に観測できる形で返す。
//      - 103 Early Hints … 先に届くヘッダ。ブラウザの responseStart はこれを見る
//      - Server-Timing   … サーバが最終応答を出すまでに実際にかけた時間
//
// 🔴 「早く返す」ための細工はしない。think の待ち時間は素直に待つ。
//    先回りで速くすると、記事が見せたい「見かけだけ下がる」状態が作れない。

import { Router } from "express";

/** Link ヘッダの値。preload を伴う 103 と、伴わない 103 を作り分ける */
const BARE_LINK = "</012/>; rel=preconnect";

/**
 * 先読みさせる資源の URL。
 *
 * 🔴 cc（資源側の Cache-Control）を振れるようにしてある。
 *    「先読みしたのに速くならない」とき、ブラウザが先読みを活かさないのか、
 *    保存できない応答なので再取得しているのかを分けるため。
 * 🔴 Link ヘッダと HTML の href は 1 文字でも違うと別の資源になる。同じ関数から作る。
 */
const assetUrl = (cc, nonce) => `/012/eh-asset.css?cc=${encodeURIComponent(cc)}&ms=150&n=${encodeURIComponent(nonce)}`;

export function register(app) {
  const router = Router();

  /**
   * 103 の有無 × preload の有無 × サーバ実処理時間 を振れる入口。
   *
   *   ?hints=preload  … 103 を送り、実際に使う資源を preload させる
   *   ?hints=bare     … 103 は送るが、その回の描画に効かないものしか載せない
   *   ?hints=none     … 103 を送らない（対照）
   *   ?ms=200         … 最終応答までにサーバが費やす時間
   */
  router.get("/012/eh", (req, res) => {
    const hints = String(req.query.hints ?? "none");
    const ms = Number.parseInt(String(req.query.ms ?? "200"), 10);
    const cc = String(req.query.cc ?? "no-store");
    // 🔴 保存可能な資源を繰り返し測ると、2 回目以降はキャッシュから返り先読みの効果が消える。
    //    測定側が試行ごとに違う値を渡し、毎回ワイヤへ出させる
    const nonce = String(req.query.n ?? "0");
    const started = process.hrtime.bigint();

    if (hints === "preload") res.writeEarlyHints({ link: [`<${assetUrl(cc, nonce)}>; rel=preload; as=style`] });
    else if (hints === "bare") res.writeEarlyHints({ link: [BARE_LINK] });

    setTimeout(() => {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      // 🔴 この値が「サーバが実際にかけた時間」。103 を送っても変わらないことを示す軸
      res.set("Server-Timing", `app;dur=${elapsed.toFixed(1)}`);
      res.set("Cache-Control", "no-store");
      res.type("text/html").send(
        `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">` +
          `<title>012 early hints (${hints})</title>` +
          `<link rel="stylesheet" href="${assetUrl(cc, nonce)}">` +
          `</head><body><h1>hints=${hints} ms=${ms} cc=${cc}</h1></body></html>`
      );
    }, ms);
  });

  /** 103 で preload させる資源。届くまでに少し待たせ、先読みの有無が効くようにする */
  router.get("/012/eh-asset.css", (req, res) => {
    const ms = Number.parseInt(String(req.query.ms ?? "150"), 10);
    const cc = String(req.query.cc ?? "no-store");
    setTimeout(() => {
      res.set("Cache-Control", cc);
      res.type("text/css").send("body{font-family:system-ui;background:#f6f6f6}\n");
    }, ms);
  });

  app.use(router);
}
