#!/usr/bin/env node
// measure-009-real-browsers.mjs — Playwright 同梱版ではなく、ホストの実ブラウザで測る（M2）
//
// 🔴 なぜ要るか: Playwright 1.62.1 が同梱する Firefox は 153.0 で、stable の 154.0 より
//    メジャーが 1 つ古い。同梱 Chromium も 151.0.7922.34 で、ホストの Chrome とパッチが違う。
//    測っている対象がクライアントの挙動そのものなので、版は結論に効く（MEASURE-01 Step 1b）。
//
// 手段はブラウザで分ける（007 と同じ）:
//   Chrome  — Playwright の channel:"chrome" が実バイナリを駆動できる（自動）
//   Firefox — Playwright から本物を駆動できないため selftest ページを開いて結果を POST させる
//   Safari  — 同上
//
// 🔴 Firefox / Safari はユーザーのブラウザでタブを開きます。プロファイルは触りません。
//
// 使い方:
//   node tools/measure-009-real-browsers.mjs --browser=chrome
//   node tools/measure-009-real-browsers.mjs --browser=firefox
//   node tools/measure-009-real-browsers.mjs --browser=safari
//   node tools/measure-009-real-browsers.mjs --aggregate
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "009-real-browsers");
const BASE = "http://localhost:8080";
const SELFTEST = `${BASE}/009-page/selftest.html`;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; })
);

const APP = { firefox: "Firefox", safari: "Safari" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getReports = async () => (await fetch(`${BASE}/009/report`)).json();

/** UA からブラウザを判定する。Safari の UA は Chrome / Firefox を含まないことで見分ける */
function identify(ua) {
  if (/Firefox\//.test(ua)) return { name: "firefox", version: (ua.match(/Firefox\/([\d.]+)/) || [])[1] ?? null };
  if (/Chrome\//.test(ua)) return { name: "chrome", version: (ua.match(/Chrome\/([\d.]+)/) || [])[1] ?? null };
  if (/Safari\//.test(ua)) return { name: "safari", version: (ua.match(/Version\/([\d.]+)/) || [])[1] ?? null };
  return { name: "unknown", version: null };
}

async function waitForNewReport(before, label, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const r = await getReports();
    if (r.count > before) return r;
    await sleep(1000);
  }
  throw new Error(`[${label}] 自己申告が届きませんでした（${timeoutMs / 1000} 秒）`);
}

async function viaChrome() {
  const before = (await getReports()).count;
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  await page.goto(SELFTEST, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("log").textContent.includes("送信しました"), null, { timeout: 120000 });
  await browser.close();
  return waitForNewReport(before, "chrome");
}

async function viaApp(which) {
  const before = (await getReports()).count;
  console.log(`[${which}] ${APP[which]} でタブを開きます。測定が終わるまで前面に置いてください。`);
  execFileSync("open", ["-a", APP[which], SELFTEST]);
  return waitForNewReport(before, which);
}

function aggregate() {
  if (!existsSync(OUT)) throw new Error(`${OUT} がありません。先に各ブラウザで測定してください。`);
  const raw = JSON.parse(readFileSync(join(OUT, "reports.json"), "utf8"));
  const byBrowser = {};
  for (const rep of raw.reports) {
    const who = identify(rep.ua ?? "");
    byBrowser[who.name] = { version: who.version, cases: rep.body?.cases ?? [] };
  }

  const ids = ["B0", "B1", "B2", "B3", "B4", "B5", "B6"];
  const names = Object.keys(byBrowser).sort();
  const lines = [
    "# 009-real-browsers (M2)",
    `measured-at: ${raw.at}`,
    `browsers: ${names.map((n) => `${n} ${byBrowser[n].version}`).join(" / ")}`,
    "",
    "🔴 Playwright 同梱版ではなくホストの実ブラウザ。判定はサーバ側の到着記録。",
    "",
  ];
  const summary = { scenario: "009-real-browsers", mode: "M2", real_browsers: {} };
  for (const n of names) summary.real_browsers[n] = byBrowser[n].version;

  for (const id of ids) {
    const row = names.map((n) => byBrowser[n].cases.find((c) => c.id === id));
    const auths = row.map((c) => c?.auth ?? "unreached");
    const agree = new Set(auths).size === 1;
    lines.push(`${id.padEnd(3)} ` + names.map((n, i) => `${n}=${auths[i]}`).join(" ") + `  ${agree ? "一致" : "🔴 乖離"}`);
    summary[`${id}_auth`] = agree ? auths[0] : auths;
    summary[`${id}_agree`] = agree;
    summary[`${id}_preflight`] = names.map((n, i) => `${n}:${row[i]?.preflight_count ?? "-"}`).join(" ");
  }
  const arrived = ids.filter((id) => summary[`${id}_auth`] === "yes");
  summary.arrived_cases = arrived;
  summary.arrived_count = arrived.length;
  summary.cases_total = ids.length;
  summary.browsers_measured = names;
  lines.push("", `届いたのは ${arrived.length} 件: ${arrived.join(", ") || "なし"}`);

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(lines.join("\n"));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (args.aggregate) return aggregate();

  const which = String(args.browser ?? "");
  if (!["chrome", "firefox", "safari"].includes(which)) {
    console.error("使い方: --browser=chrome|firefox|safari  または --aggregate");
    process.exit(3);
  }
  const r = which === "chrome" ? await viaChrome() : await viaApp(which);
  writeFileSync(join(OUT, "reports.json"), JSON.stringify({ at: new Date().toISOString(), ...r }, null, 2) + "\n");
  console.log(`[${which}] 自己申告を受け取りました（累計 ${r.count} 件）`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
