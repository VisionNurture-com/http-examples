#!/usr/bin/env node
// measure-007-real-browsers.mjs — Playwright 同梱版ではなく、ホストの実ブラウザで測る（M2）
//
// 🔴 なぜ要るか: Playwright 1.62.1 が同梱する Firefox は 153.0 で、stable の 154.0 より
//    メジャーが 1 つ古い。007 の中心的な発見（classic worker の MIME 検査を Chromium だけが
//    通す）の対照が現行版を指さなくなるため、本物でも測る。004 でも同じ理由で実ブラウザ
//    3 種を別に測っている。
//
// 手段はブラウザで分ける:
//   Chrome  — Playwright の channel:"chrome" が実バイナリを駆動できる（自動）
//   Firefox — Playwright から本物を駆動できないため /007/selftest を開いて結果を POST させる
//   Safari  — 同上
//
// 🔴 Firefox / Safari はユーザーのブラウザでタブを開きます。プロファイルは触りません。
//    測定後、タブは開いたまま残ります（閉じる操作は自動化に権限が要るため行いません）。
//
// 使い方:
//   node tools/measure-007-real-browsers.mjs --browser=chrome
//   node tools/measure-007-real-browsers.mjs --browser=firefox
//   node tools/measure-007-real-browsers.mjs --browser=safari
//   node tools/measure-007-real-browsers.mjs --aggregate     # 収集済みの報告を results/ へ確定
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "007-real-browsers");
const BASE = "http://localhost:8080";
const SELFTEST = `${BASE}/007/selftest`;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; })
);

const APP = { firefox: "Firefox", safari: "Safari" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getReports = async () => (await fetch(`${BASE}/007/report`)).json();

/** UA からブラウザを判定する。Safari の UA は Chrome/Firefox を含まないことで見分ける */
function identify(ua) {
  if (/Firefox\//.test(ua)) return { name: "firefox", version: (ua.match(/Firefox\/([\d.]+)/) || [])[1] ?? null };
  if (/Chrome\//.test(ua)) return { name: "chrome", version: (ua.match(/Chrome\/([\d.]+)/) || [])[1] ?? null };
  if (/Safari\//.test(ua)) return { name: "safari", version: (ua.match(/Version\/([\d.]+)/) || [])[1] ?? null };
  return { name: "unknown", version: null };
}

/**
 * JavaScript MIME type「でない」ケースか。
 * 🔴 フィールド名は selftest 側が `js`。取り違えると全件が違反として数えられるため、
 *    値が入っていない場合は落とす（黙って真にしない）。
 */
function isNonJs(w) {
  const v = w.js ?? w.is_javascript_mime;
  if (typeof v !== "boolean") throw new Error(`worker ケースに js フラグがありません: ${JSON.stringify(w).slice(0, 80)}`);
  return v === false;
}

/** ホストにインストールされている版を Info.plist から読む（UA より正確） */
function installedVersion(appName) {
  try {
    return execFileSync("/usr/bin/defaults", [
      "read", `/Applications/${appName}.app/Contents/Info.plist`, "CFBundleShortVersionString",
    ]).toString().trim();
  } catch { return null; }
}

async function waitForNewReport(before, label, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await getReports();
    if (r.length > before) return r[r.length - 1];
    await sleep(1000);
  }
  throw new Error(`[${label}] ${timeoutMs / 1000} 秒待っても報告が届きませんでした`);
}

async function viaChrome() {
  // channel:"chrome" は Playwright 同梱の Chromium ではなくホストの Chrome を起動する
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const page = await browser.newPage();
  const before = (await getReports()).length;
  await page.goto(SELFTEST, { waitUntil: "load" });
  await page.waitForFunction(() => /完了しました/.test(document.getElementById("state")?.textContent ?? ""), null, { timeout: 60000 });
  const rep = await waitForNewReport(before, "chrome");
  await browser.close();
  return rep;
}

async function viaOpen(which) {
  const app = APP[which];
  const before = (await getReports()).length;
  console.log(`${app} を開きます（タブは測定後も残ります）…`);
  execFileSync("/usr/bin/open", ["-a", app, SELFTEST]);
  return await waitForNewReport(before, which);
}

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  if (args.aggregate) {
    const reports = await getReports();
    if (reports.length === 0) throw new Error("報告が 0 件です。先に各ブラウザで測定してください");
    const byBrowser = {};
    for (const r of reports) {
      const id = identify(r.ua ?? "");
      byBrowser[id.name] = { ...r, detected: id };
    }
    const browsers = {};
    for (const [name, r] of Object.entries(byBrowser)) {
      const installed = name === "chrome" ? installedVersion("Google Chrome")
        : name === "firefox" ? installedVersion("Firefox")
        : name === "safari" ? installedVersion("Safari") : null;
      browsers[name] = installed ?? r.detected.version;
      // 🔴 `<name>.firefox.json` は check-provenance が Playwright 同梱版の生ファイルと
      //    見なす命名（browsersFromRawFiles の正規表現）。実ブラウザはハイフン形で分ける
      writeFileSync(join(OUT, `real-${name}.json`), JSON.stringify(r, null, 2) + "\n");
    }

    const summary = { scenario: "007-real-browsers", mode: "M2", real_browsers: browsers };
    const names = Object.keys(byBrowser).sort();
    for (const name of names) {
      const d = byBrowser[name].data;
      // classic worker が JavaScript MIME でない型をいくつ読み込んだか
      // 🔴 selftest 側のフィールド名は `js`。`is_javascript_mime` を見ると undefined になり
      //    !undefined が常に真になって text/javascript まで違反として数えてしまう（2026-08-21 実測で発覚）
      const nonJs = Object.values(d.worker).filter((w) => isNonJs(w) && w.result === "loaded");
      summary[`non_js_loaded_${name}`] = nonJs.length;
      summary[`D1_executed_${name}`] = d.destination.D1.executed;
      summary[`D2_executed_${name}`] = d.destination.D2.executed;
      summary[`D5_executed_${name}`] = d.destination.D5.executed;
      summary[`D7_executed_${name}`] = d.destination.D7.executed;
      summary[`D9_executed_${name}`] = d.destination.D9.executed;
      summary[`D10_executed_${name}`] = d.destination.D10.executed;
      summary[`D11_parsed_as_html_${name}`] = d.doc.D11.hasBoldElement;
      summary[`D12_parsed_as_html_${name}`] = d.doc.D12.hasBoldElement;
    }
    summary.non_js_types_total = 6;
    summary.browsers_measured = names;

    const lines = [
      "# 007-real-browsers (M2)",
      `measured-at: ${new Date().toISOString()}`,
      `host: ${process.platform} ${process.arch} / node ${process.version}`,
      "🔴 Playwright 同梱版ではなく、ホストにインストールされた実ブラウザで測定",
      `実ブラウザの版: ${JSON.stringify(browsers)}`,
      "",
    ];
    for (const name of names) {
      const d = byBrowser[name].data;
      lines.push(`--- ${name} ${browsers[name]} ---`);
      lines.push(`ua: ${byBrowser[name].ua}`);
      for (const [id, v] of Object.entries(d.destination)) {
        lines.push(`${id.padEnd(4)} ${v.dest.padEnd(15)} ct=${v.ct.padEnd(11)} nosniff=${v.nosniff}  event=${v.event} executed=${v.executed}`);
      }
      for (const [id, v] of Object.entries(d.worker)) {
        lines.push(`${id} ct=${v.ct.padEnd(26)} served=${String(v.served).padEnd(30)} ${v.result}`);
      }
      for (const [id, v] of Object.entries(d.doc)) {
        lines.push(`${id} document contentType=${v.contentType} hasBold=${v.hasBoldElement}`);
      }
      lines.push("");
    }
    writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    console.log(lines.join("\n"));
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const which = String(args.browser ?? "");
  const rep = which === "chrome" ? await viaChrome()
    : which === "firefox" || which === "safari" ? await viaOpen(which)
    : (() => { throw new Error("--browser=chrome|firefox|safari または --aggregate を指定してください"); })();
  const id = identify(rep.ua ?? "");
  console.log(`受領: ${id.name} ${id.version}`);
  const d = rep.data;
  const nonJs = Object.values(d.worker).filter((w) => isNonJs(w) && w.result === "loaded").length;
  console.log(`classic worker が読み込んだ非 JavaScript MIME: ${nonJs} / 6`);
  console.log(`D9(worker text/html, nosniff なし) executed=${d.destination.D9.executed}`);
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
