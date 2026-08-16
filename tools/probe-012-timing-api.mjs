#!/usr/bin/env node
// probe-012-timing-api.mjs — Resource Timing の属性が実装に存在するかを 4 系統で確認する（M2・docker 不要）
//
// 測るもの:
//   Chrome 133 の release notes は「firstResponseHeadersStart を導入した」と書いているが、
//   W3C Resource Timing 仕様の IDL にその名前はない（finalResponseHeadersStart が定義されている）。
//   どちらが実装に存在するかは、名前を数えるのではなく実装へ問い合わせて決める。
//
// 🔴 判定は prototype への `in` で取る。インスタンスの値（0 かどうか）では
//    「属性がない」と「属性はあるが今回の遷移では 0」を分けられない。
//
// 使い方: node tools/probe-012-timing-api.mjs
// 出力  : results/012-timing-api/api-surface.json（生ログ）

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "results", "012-timing-api");

const NAMES = [
  "requestStart",
  "responseStart",
  "firstInterimResponseStart",
  "finalResponseHeadersStart",
  "firstResponseHeadersStart",
];

/** 1 エンジンぶんの API 表面を取る。起動できなければ launchError を残して続行する */
async function probe(label, launcher, opts = {}) {
  let browser;
  try {
    browser = await launcher.launch(opts);
  } catch (e) {
    return { label, launchError: String(e).split("\n")[0] };
  }
  const page = await browser.newPage();
  await page.goto("about:blank");
  const r = await page.evaluate((names) => {
    const surface = {};
    for (const n of names) {
      surface[n] = {
        resourceTiming: n in PerformanceResourceTiming.prototype,
        navigationTiming: n in PerformanceNavigationTiming.prototype,
      };
    }
    return { userAgent: navigator.userAgent, surface };
  }, NAMES);
  const version = browser.version();
  await browser.close();
  return { label, version, userAgent: r.userAgent, surface: r.surface };
}

const results = [];
results.push(await probe("chromium (playwright 同梱)", chromium));
results.push(await probe("Google Chrome (installed / channel=chrome)", chromium, { channel: "chrome" }));
results.push(await probe("firefox (playwright 同梱)", firefox));
results.push(await probe("webkit (playwright 同梱)", webkit));

mkdirSync(OUT_DIR, { recursive: true });
const payload = { probedAt: new Date().toISOString(), names: NAMES, results };
writeFileSync(join(OUT_DIR, "api-surface.json"), JSON.stringify(payload, null, 2) + "\n");

writeFileSync(
  join(OUT_DIR, "run.log"),
  [
    `measured-at: ${payload.probedAt}`,
    `scenario: 012-timing-api`,
    `mode: M0`,
    `judgement: prototype への in で属性の実在を見る（インスタンスの値では判定しない）`,
    `---`,
    ...results.map((r) => JSON.stringify(r)),
    "",
  ].join("\n")
);

for (const r of results) {
  if (r.launchError) {
    console.log(`\n=== ${r.label} === 起動できませんでした: ${r.launchError}`);
    continue;
  }
  console.log(`\n=== ${r.label} (version=${r.version}) ===`);
  for (const n of NAMES) {
    const s = r.surface[n];
    console.log(
      `  ${n.padEnd(28)} ResourceTiming=${s.resourceTiming ? "YES" : "no "}  NavigationTiming=${s.navigationTiming ? "YES" : "no "}`
    );
  }
}
console.log(`\n生ログ: results/012-timing-api/api-surface.json`);
