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
import { register as registerCompression } from "./012-compression/routes.mjs";

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
registerCompression(app);

app.listen(PORT, () => {
  console.log(`[app] listening on ${PORT} (node ${process.versions.node})`);
});
