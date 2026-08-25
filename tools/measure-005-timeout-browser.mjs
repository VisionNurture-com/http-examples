#!/usr/bin/env node
// measure-005-timeout-browser.mjs — ブラウザの fetch は何秒待つか（M2）
//
// M1（tools/measure-005-timeout.mjs）と同じ足場へ、Playwright の 3 エンジンから
// AbortController なしの fetch を投げる。
//
// 🔴 測るのは応答待ちのタイムアウトのみ。
// 🔴 Playwright 同梱のブラウザは実ブラウザの代理にならない。同梱版で測ったことを
//    そのまま記録し、実ブラウザは未測定と明記する（MEASURE-01 Step 1b）。
//
// 使い方: node tools/measure-005-timeout-browser.mjs
// 🔴 実行前に docker compose up -d --wait と npx playwright install しておくこと。

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "005-fetch-timeout-browser";
const OUT = join(ROOT, "results", ID);
const URL_ = "http://localhost:8086/005/never-responds";
const CAP_MS = 330_000;

const ENGINES = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const sec = (ms) => (ms / 1000).toFixed(1);

async function measure(name, launcher) {
  const browser = await launcher.launch();
  const version = browser.version();
  const page = await browser.newPage();
  try {
    const r = await page.evaluate(
      async ([url, cap]) => {
        const t0 = performance.now();
        // 🔴 上限で止めたことは **フラグ**で判定する。abort の理由に載せた文字列は
        //    エンジンによって握り潰される（WebKit は "Fetch is aborted" に差し替える）。
        //    2026-08-25 の初回測定で、これを取り違えて WebKit だけ「切れた」と誤判定した。
        let capped = false;
        try {
          const ctl = new AbortController();
          const capper = setTimeout(() => { capped = true; ctl.abort(); }, cap);
          try {
            await fetch(url, { signal: ctl.signal });
            return { elapsed_ms: performance.now() - t0, outcome: "応答が返った", error: null, capped_by_us: false };
          } finally { clearTimeout(capper); }
        } catch (e) {
          return {
            elapsed_ms: performance.now() - t0,
            outcome: capped ? "上限まで切れなかった" : "クライアント側で切れた",
            error: { name: e.name, message: e.message },
            capped_by_us: capped,
          };
        }
      },
      [URL_, CAP_MS]
    );
    return { ...r, version };
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const summary = { scenario: ID, mode: "M2", measured_at: new Date().toISOString(), cap_ms: CAP_MS };

  log("==========================================");
  log(`005-fetch-timeout-browser (M2)`);
  log(`measured-at: ${summary.measured_at} / 上限 ${sec(CAP_MS)} 秒`);
  log("==========================================");
  log("");
  log("足場: GET /005/never-responds（接続は成立・応答は返さない）");
  log("🔴 Playwright 同梱のブラウザで測った値。実ブラウザは未測定。");
  log("");

  const results = await Promise.all(ENGINES.map(([n, l]) => measure(n, l).then((r) => [n, r])));

  const browsers = {};
  const timedOut = [];
  for (const [name, r] of results) {
    browsers[name] = r.version;
    summary[`${name}_elapsed_s`] = Number(sec(r.elapsed_ms));
    summary[`${name}_outcome`] = r.outcome;
    summary[`${name}_error`] = r.capped_by_us ? null : (r.error ? r.error.name : null);
    if (r.outcome === "クライアント側で切れた") timedOut.push(name);
    log(`  ${name} ${r.version}`);
    log(`    経過 ${sec(r.elapsed_ms)} 秒 — ${r.outcome}`);
    log(`    ${r.capped_by_us ? `（上限で当方が中断。エンジンが返した文言は ${r.error.name} / ${r.error.message}）` : r.error ? `エラー: ${r.error.name} / ${r.error.message}` : "エラーなし"}`);
    log("");
    writeFileSync(join(OUT, `timeout.${name}.json`), JSON.stringify(r, null, 2) + "\n");
  }
  summary.browsers = browsers;
  summary.timed_out_engines = timedOut;
  summary.timed_out_count = timedOut.length;
  summary.engines_total = ENGINES.length;

  log("--- 読み取り ---");
  log(`3 エンジンのうち、既定で切れたのは ${timedOut.length} 件（${timedOut.join(", ") || "なし"}）`);

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
