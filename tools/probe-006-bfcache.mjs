#!/usr/bin/env node
// probe-006-bfcache.mjs — 「戻る」を自動で測れるかどうかの事前調査（測定値ではない）
//
// Playwright は既定で bfcache を全ブラウザで無効化すると公式に明記している。
// そのまま goBack() を測ると、装置の都合で bfcache を殺した値になり、
// 実ブラウザの読者が踏む挙動と食い違う。
//
// そこで測定に入る前に、次の 2 点を実測で確かめる。
//   1. 既定の Playwright で bfcache が本当に無効か（pageshow の persisted で判る）
//   2. 無効化を外す手立てが効くか（chromium は既定 args の除去、firefox は pref）
//
// 判定は 2 系統の独立な証拠でとる。
//   - ブラウザ内: pageshow の persisted（web.dev/articles/bfcache）
//   - サーバ側  : ページ自身の到着回数（復元されたなら 2 回目は届かない）
//
// 🔴 判定対象ページは no-cache にする。no-store のページは bfcache の対象外になるため、
//    既定の no-store のまま測ると「装置が bfcache を殺した」のか
//    「ページ指定が bfcache を殺した」のか切り分けられない。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "006-cache");
const LOG = join(OUT, "access.log");
const BASE = "http://localhost:8084";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logLines() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8").split("\n").filter(Boolean);
}

/** from 行目以降で、cs=<tag> のページ到着を数える */
function countPageSince(from, tag) {
  return logLines()
    .slice(from)
    .filter((l) => l.includes("/006/page") && l.includes(`cs=${tag}`)).length;
}

const CONFIGS = [
  { engine: "chromium", label: "default", launch: {} },
  {
    engine: "chromium",
    label: "bfcache-on",
    // Playwright の既定 args に --disable-back-forward-cache が含まれる
    // （node_modules/playwright-core/lib/coreBundle.js で確認）。これを外す。
    launch: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
  },
  { engine: "firefox", label: "default", launch: {} },
  {
    engine: "firefox",
    label: "bfcache-on",
    launch: { firefoxUserPrefs: { "browser.sessionhistory.max_total_viewers": 10 } },
  },
  { engine: "webkit", label: "default", launch: {} },
];

const LAUNCHERS = { chromium, firefox, webkit };

async function probe(cfg, tag) {
  const browser = await LAUNCHERS[cfg.engine].launch(cfg.launch);
  const context = await browser.newContext();
  const page = await context.newPage();

  const before = logLines().length;
  const asset = encodeURIComponent(`/006/asset/app.css?v=plain&sc=bfprobe&cs=${tag}`);
  const pageA = `${BASE}/006/page?asset=${asset}&cc=no-cache&sc=bfprobe&cs=${tag}&n=1`;
  const pageB = `${BASE}/006/page?asset=${asset}&cc=no-cache&sc=bfprobe&cs=${tag}&n=2`;

  await page.goto(pageA);
  await page.goto(pageB);
  const backResp = await page.goBack();
  await sleep(800);

  const ps = await page.evaluate(() => window.__ps ?? null);
  const arrivals = countPageSince(before, tag);

  await context.close();
  await browser.close();

  return {
    engine: cfg.engine,
    config: cfg.label,
    // 復元されていれば pageshow が persisted=true で 2 度目に発火し、配列が残る
    pageshow: ps,
    restored_by_pageshow: Array.isArray(ps) && ps.length >= 2 && ps[ps.length - 1] === true,
    page_arrivals: arrivals,
    back_response_null: backResp === null,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const cfg of CONFIGS) {
    const tag = `${cfg.engine}-${cfg.label}`;
    let r;
    try {
      r = await probe(cfg, tag);
    } catch (e) {
      r = { engine: cfg.engine, config: cfg.label, error: String(e && e.message ? e.message : e) };
    }
    rows.push(r);
    console.log(
      `${r.engine.padEnd(9)} ${String(r.config).padEnd(11)} ` +
        (r.error
          ? `ERROR ${r.error}`
          : `persisted=${JSON.stringify(r.pageshow)} 到着=${r.page_arrivals} → ${r.restored_by_pageshow ? "bfcache から復元" : "復元されていない"}`)
    );
  }
  writeFileSync(join(OUT, "bfcache-probe.json"), JSON.stringify(rows, null, 2) + "\n");
  console.log(`\nresults/006-cache/bfcache-probe.json に保存しました。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
