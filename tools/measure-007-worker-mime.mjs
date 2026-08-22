#!/usr/bin/env node
// measure-007-worker-mime.mjs — classic worker の MIME 検査を型を振って測る（M2・実ブラウザ）
//
// HTML Standard の「fetch a classic worker script」は、classic script と違って
// MIME 検査を持つ:
//   > If all of the following are true: response's URL's scheme is an HTTP(S) scheme;
//     and the result of extracting a MIME type from response's header list is not a
//     JavaScript MIME type, then run onComplete given null, and abort these steps.
// （classic script の側は「For historical reasons, this algorithm does not include
//   MIME type checking, unlike the other script-fetching algorithms in this section.」）
//
// 007-nosniff-destination の D9 で、Chromium だけがこの検査を通り抜けた。
// 型を振って、通り抜けの範囲を確定させる。
//
// 🔴 判定は worker からの postMessage が届いたかだけで機械的に行う。
// 🔴 nosniff は付けない。付けると Fetch Standard §3.6.1 の別経路で止まり、
//    「classic worker 自身の MIME 検査が働いたか」を分離できなくなる。
//
// 使い方: node tools/measure-007-worker-mime.mjs [--browser=chromium|firefox|webkit|all]
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "007-worker-mime");
const BASE = "http://localhost:8080";
const LAUNCHERS = { chromium, firefox, webkit };

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; })
);

// JavaScript MIME type は 1 件だけ（対照）。残りはすべて仕様上「読み込まない」はず
const TYPES = [
  { id: "W1", ct: "text/javascript",          js: true },
  { id: "W2", ct: "text/html",                js: false },
  { id: "W3", ct: "text/plain",               js: false },
  { id: "W4", ct: "application/json",         js: false },
  { id: "W5", ct: "text/css",                 js: false },
  { id: "W6", ct: "image/png",                js: false },
  { id: "W7", ct: "application/octet-stream", js: false },
];

async function runBrowser(name, lines) {
  const browser = await LAUNCHERS[name].launch();
  const version = browser.version();
  const page = await browser.newPage();
  await page.goto(`${BASE}/007/probe`, { waitUntil: "load" });
  lines.push(`\n--- ${name} ${version} ---`);
  const rows = {};
  for (const t of TYPES) {
    const url = `${BASE}/007/asset?kind=worker&flag=${t.id}&ct=${encodeURIComponent(t.ct)}`;
    // サーバが意図どおりのヘッダを返しているかを同じページから検算する
    const served = await page.evaluate(async (u) => (await fetch(u)).headers.get("content-type"), url);
    const result = await page.evaluate(
      ({ u, flag }) =>
        new Promise((res) => {
          let w;
          const timer = setTimeout(() => { try { w?.terminate(); } catch {} res("timeout"); }, 4000);
          try { w = new Worker(u); } catch { clearTimeout(timer); return res("throw"); }
          w.onmessage = (m) => { clearTimeout(timer); w.terminate(); res(m.data === flag ? "loaded" : "unexpected"); };
          w.onerror = () => { clearTimeout(timer); res("blocked"); };
        }),
      { u: url, flag: t.id }
    );
    rows[t.id] = { ct: t.ct, is_javascript_mime: t.js, served, result };
    lines.push(`${t.id} ct=${t.ct.padEnd(26)} served=${String(served).padEnd(30)} ${result}`);
  }
  await browser.close();
  writeFileSync(join(OUT, `worker.${name}.json`), JSON.stringify({ version, rows }, null, 2) + "\n");
  return { version, rows };
}

async function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const want = args.browser && args.browser !== "all" ? [args.browser] : ["chromium", "firefox", "webkit"];
  const lines = [
    "# 007-worker-mime (M2)",
    `measured-at: ${new Date().toISOString()}`,
    `host: ${process.platform} ${process.arch} / node ${process.version}`,
    `base: ${BASE}`,
    "nosniff は付けない（classic worker 自身の MIME 検査を分離するため）",
  ];
  const browsers = {}, all = {};
  for (const b of want) { const r = await runBrowser(b, lines); browsers[b] = r.version; all[b] = r.rows; }

  const summary = { scenario: "007-worker-mime", mode: "M2", browsers };
  for (const t of TYPES) {
    for (const b of want) summary[`${t.id}_${b}`] = all[b][t.id].result;
  }
  // 「JavaScript MIME でない型を読み込んでしまった」件数 = 仕様からの逸脱
  for (const b of want) {
    summary[`non_js_loaded_${b}`] = TYPES.filter((t) => !t.js && all[b][t.id].result === "loaded").length;
  }
  summary.non_js_types_total = TYPES.filter((t) => !t.js).length;

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(lines.join("\n"));
  console.log("\n" + JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
