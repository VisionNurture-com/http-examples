#!/usr/bin/env node
// capture-007-browser.mjs — 型を偽ったとき destination ごとに何が止まるかを測る（M2・実ブラウザ）
//
// 仕様（WHATWG Fetch §3.6.1「Should response to request be blocked due to nosniff?」）では、
// nosniff によるブロックは destination が script-like か "style" のときにしか適用されない。
//   > Only request destinations that are script-like or "style" are considered
//     as any exploits pertain to them.
// 一方 HTML Standard は、classic script について
//   > For historical reasons, this algorithm does not include MIME type checking
// と述べ、module script と classic worker script には MIME 検査を課している。
//
// つまり「型を偽ると止まる / 止まらない」は destination で割れるはずで、
// その割れ方を 3 エンジンで実測する。
//
// 🔴 document ナビゲーション（D11 / D12）は対照。MIME Sniffing Standard により
//    text/plain は HTML へ sniff されないため、nosniff の有無で差が出ないはず。
//    差が出ないこと自体が「nosniff がないと text/plain が HTML として解釈される」
//    という通説の反証になる。
// 🔴 判定は生の観測値のみで機械的に行う。予測と食い違ってもそのまま記録する。
//
// 使い方: node tools/capture-007-browser.mjs [--browser=chromium|firefox|webkit|all]
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "007-nosniff-destination");
const RUNLOG = join(OUT, "run.log");
const BASE = "http://localhost:8080";
const PROBE = `${BASE}/007/probe`;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const LAUNCHERS = { chromium, firefox, webkit };

/** destination × 配る型 × nosniff。flag は素材の中身に埋め込まれ、実行されたかの目印になる */
const CASES = [
  { id: "D1",  dest: "classic script", kind: "js",     ct: "text/html",  nosniff: 0 },
  { id: "D2",  dest: "classic script", kind: "js",     ct: "text/html",  nosniff: 1 },
  { id: "D3",  dest: "classic script", kind: "js",     ct: "text/plain", nosniff: 0 },
  { id: "D4",  dest: "classic script", kind: "js",     ct: "text/plain", nosniff: 1 },
  { id: "D5",  dest: "module script",  kind: "js",     ct: "text/html",  nosniff: 0 },
  { id: "D6",  dest: "module script",  kind: "js",     ct: "text/html",  nosniff: 1 },
  { id: "D7",  dest: "style",          kind: "css",    ct: "text/plain", nosniff: 0 },
  { id: "D8",  dest: "style",          kind: "css",    ct: "text/plain", nosniff: 1 },
  { id: "D9",  dest: "classic worker", kind: "worker", ct: "text/html",  nosniff: 0 },
  { id: "D10", dest: "classic worker", kind: "worker", ct: "text/html",  nosniff: 1 },
  { id: "D11", dest: "document",       kind: "doc",    ct: "text/plain", nosniff: 0 },
  { id: "D12", dest: "document",       kind: "doc",    ct: "text/plain", nosniff: 1 },
];

const assetUrl = (c, flag) =>
  `${BASE}/007/asset?kind=${c.kind}&flag=${flag}&ct=${encodeURIComponent(c.ct)}` +
  (c.nosniff ? "&nosniff=1" : "");

function log(line) {
  console.log(line);
  appendFileSync(RUNLOG, line + "\n");
}

/** 1 ケースを 1 ページで測る。ページは使い回さない（前のケースの副作用を持ち込まないため） */
async function runCase(context, c) {
  const flag = `${c.id}`;
  const page = await context.newPage();
  const url = assetUrl(c, flag);
  let observed;

  try {
    if (c.dest === "document") {
      // 対照: そのままナビゲートし、HTML として解釈されたかを見る
      const navUrl = `${BASE}/007/text-as-html${c.nosniff ? "-nosniff" : ""}`;
      const resp = await page.goto(navUrl, { waitUntil: "load" });
      observed = await page.evaluate(() => ({
        contentType: document.contentType,
        hasBoldElement: !!document.querySelector("b"),
        bodyText: (document.body?.innerText ?? "").trim().slice(0, 40),
      }));
      observed.status = resp?.status() ?? null;
    } else {
      await page.goto(PROBE, { waitUntil: "load" });
      observed = await page.evaluate(
        async ({ url, dest, flag }) => {
          const wait = (el) =>
            new Promise((res) => {
              el.onload = () => res("load");
              el.onerror = () => res("error");
              document.head.appendChild(el);
            });

          if (dest === "classic script" || dest === "module script") {
            const s = document.createElement("script");
            if (dest === "module script") s.type = "module";
            s.src = url;
            const ev = await wait(s);
            return { event: ev, executed: window.__flags?.[flag] === true };
          }
          if (dest === "style") {
            const l = document.createElement("link");
            l.rel = "stylesheet";
            l.href = url;
            const ev = await wait(l);
            const v = getComputedStyle(document.documentElement)
              .getPropertyValue(`--probe-${flag}`)
              .trim();
            return { event: ev, executed: v === "1" };
          }
          if (dest === "classic worker") {
            return await new Promise((res) => {
              let w;
              const done = (o) => {
                try { w?.terminate(); } catch {}
                res(o);
              };
              const timer = setTimeout(() => done({ event: "timeout", executed: false }), 4000);
              try {
                w = new Worker(url);
              } catch (e) {
                clearTimeout(timer);
                return done({ event: "throw", executed: false, detail: String(e).slice(0, 80) });
              }
              w.onmessage = (m) => { clearTimeout(timer); done({ event: "message", executed: m.data === flag }); };
              w.onerror = () => { clearTimeout(timer); done({ event: "error", executed: false }); };
            });
          }
          return { event: "unsupported", executed: false };
        },
        { url, dest: c.dest, flag }
      );
    }
  } finally {
    await page.close();
  }
  return observed;
}

async function runBrowser(name) {
  const browser = await LAUNCHERS[name].launch();
  const version = browser.version();
  const context = await browser.newContext();
  const rows = {};
  log(`\n--- ${name} ${version} ---`);
  for (const c of CASES) {
    const o = await runCase(context, c);
    rows[c.id] = { ...c, ...o };
    const verdict =
      c.dest === "document"
        ? `contentType=${o.contentType} hasBold=${o.hasBoldElement}`
        : `event=${o.event} executed=${o.executed}`;
    log(`${c.id.padEnd(4)} ${c.dest.padEnd(15)} ct=${c.ct.padEnd(11)} nosniff=${c.nosniff}  ${verdict}`);
  }
  await browser.close();
  writeFileSync(join(OUT, `destination.${name}.json`), JSON.stringify({ version, rows }, null, 2) + "\n");
  return { version, rows };
}

async function main() {
  // 🔴 再実行でログが累積するとカウントが重複する。出力先を作り直す
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const want = args.browser && args.browser !== "all" ? [args.browser] : ["chromium", "firefox", "webkit"];
  writeFileSync(
    RUNLOG,
    [
      "# 007-nosniff-destination (M2)",
      `measured-at: ${new Date().toISOString()}`,
      `host: ${process.platform} ${process.arch} / node ${process.version}`,
      `playwright: ${JSON.parse(readFileSync(join(ROOT, "node_modules/playwright/package.json"), "utf8")).version}`,
      `base: ${BASE}`,
      "",
    ].join("\n")
  );

  const browsers = {};
  const all = {};
  for (const b of want) {
    const { version, rows } = await runBrowser(b);
    browsers[b] = version;
    all[b] = rows;
  }

  // 集計: ケースごとに 3 エンジンの判定が一致したか
  const summary = { scenario: "007-nosniff-destination", mode: "M2", browsers };
  for (const c of CASES) {
    if (c.dest === "document") {
      const cts = want.map((b) => all[b][c.id].contentType);
      const bolds = want.map((b) => all[b][c.id].hasBoldElement);
      summary[`${c.id}_content_type_all`] = [...new Set(cts)].length === 1 ? cts[0] : cts.join("|");
      summary[`${c.id}_parsed_as_html_any`] = bolds.some(Boolean);
    } else {
      const ex = want.map((b) => all[b][c.id].executed);
      summary[`${c.id}_executed_all`] = ex.every(Boolean) ? "all" : ex.some(Boolean) ? "split" : "none";
    }
  }
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  log("\n" + JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
