#!/usr/bin/env node
// aggregate-008-header-always.mjs — run.log を summary.json に畳む（M0）
//
// run.log は curl の応答ヘッダをケースごとに並べたもの。ここからケースごとに
// 「CORS ヘッダが付いていたか」を機械的に判定する。
// 🔴 判定は生ログの grep 相当のみで行い、予測は入れない。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "results", "008-header-always");
const LOG = join(DIR, "run.log");

if (!existsSync(LOG)) {
  console.error("results/008-header-always/run.log がありません。先に run.sh を実行してください。");
  process.exit(2);
}

const text = readFileSync(LOG, "utf8");
const blocks = text.split(/^## /m).slice(1);

const summary = { case_count: blocks.length };
for (const b of blocks) {
  const [head, ...rest] = b.split("\n");
  const path = head.trim();                       // 例: /008/always/ok
  const body = rest.join("\n");
  const id = path.replace(/^\/008\//, "").replace(/\//g, "_");
  const status = (body.match(/^HTTP\/[\d.]+ (\d{3})/m) || [])[1];
  const acao = /^access-control-allow-origin:/im.test(body);
  const acam = /^access-control-allow-methods:/im.test(body);
  const acah = /^access-control-allow-headers:/im.test(body);
  const xextra = /^x-extra:/im.test(body);

  summary[`${id}_status`] = status ? Number(status) : null;
  summary[`${id}_cors_header_count`] = [acao, acam, acah].filter(Boolean).length;
  if (xextra) summary[`${id}_x_extra`] = true;
}

writeFileSync(join(DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`[aggregate] header-always — ${blocks.length} ケースを畳みました`);
