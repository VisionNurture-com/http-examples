#!/usr/bin/env node
// measure-009-redirect-browser.mjs — オリジンの境界はどこで切れるか（M2・ブラウザ）
//
// 同じ 7 ケースを curl（009-redirect-origin）とブラウザで測り、判定が一致するかを見る。
//
// 🔴 判定はサーバ側の到着記録で行う。
//    ブラウザの fetch が成功したかどうかだけでは、CORS で落ちたのか
//    Authorization が消えたのかを区別できない。
//
// 🔴 Authorization は非単純ヘッダのため、クロスオリジンの各ホップで preflight が飛ぶ。
//    preflight は資格情報を載せずに飛ぶため、本番リクエストと数え違えると結果が壊れる。
//    到着記録はメソッドを持つので OPTIONS を除いて数える。
//
// 使い方: node tools/measure-009-redirect-browser.mjs [--browser=chromium|firefox|webkit]
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "009-redirect-browser";
const OUT = join(ROOT, "results", ID);
const ORIGIN = "http://localhost:8080";
const PAGE = `${ORIGIN}/009-page/`;
const TOKEN = "Bearer MEASUREMENT-TOKEN";

const LAUNCHERS = { chromium, firefox, webkit };

const CASES = [
  { id: "B0", path: "/009/whoami", desc: "対照（リダイレクトなし）" },
  { id: "B1", path: "/009/redirect/same", desc: "同一オリジン・パス差" },
  { id: "B2", path: "/009/redirect/port", desc: "ポートだけ違う" },
  { id: "B3", path: "/009/redirect/host", desc: "ホストだけ違う" },
  { id: "B4", path: "/009/redirect/scheme", desc: "http → https" },
  { id: "B5", path: "/009/redirect/back", desc: "元のオリジンへ復帰（A→B→A）" },
  { id: "B6", path: "/009/redirect/same-then-cross", desc: "同一→別（A1→A2→B）" },
  // 🔴 サブドメインは Fetch 仕様では別オリジン。Go の net/http だけが subdomain match で
  //    転送するため、ブラウザ側も測って対照を取る。
  { id: "B7", path: "/009/redirect/subdomain", desc: "サブドメイン（localhost→sub.localhost）" },
];

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

async function reset() {
  await fetch(`${ORIGIN}/009/api/__reset`, { method: "POST" });
}

async function arrivals() {
  const r = await fetch(`${ORIGIN}/009/api/arrivals`);
  return (await r.json()).arrivals ?? [];
}

/**
 * 1 ケースを 1 ブラウザで測る。
 * 判定は到着記録の「最後の非 OPTIONS な /009/whoami」に auth があったか。
 */
async function runCase(page, c) {
  await reset();
  const fetchResult = await page.evaluate(
    async ([url, token]) => {
      try {
        const res = await fetch(url, { headers: { Authorization: token } });
        let body = null;
        try { body = await res.json(); } catch { /* JSON でない応答 */ }
        return { ok: res.ok, status: res.status, reported: body?.auth ?? null };
      } catch (e) {
        return { ok: false, status: null, error: String(e && e.message ? e.message : e) };
      }
    },
    [`${ORIGIN}${c.path}`, TOKEN]
  );

  const rows = await arrivals();
  const finals = rows.filter((r) => r.method !== "OPTIONS" && r.path.startsWith("/009/whoami"));
  const last = finals.length ? finals[finals.length - 1] : null;
  return {
    id: c.id,
    desc: c.desc,
    fetch_ok: fetchResult.ok,
    fetch_error: fetchResult.error ?? null,
    reached_end: last !== null,
    auth: last ? last.auth : null,
    preflight_count: rows.filter((r) => r.method === "OPTIONS").length,
    hops_recorded: rows.filter((r) => r.method !== "OPTIONS").length,
  };
}

async function runBrowser(name) {
  const browser = await LAUNCHERS[name].launch();
  const version = browser.version();
  const page = await browser.newPage();
  await page.goto(PAGE, { waitUntil: "load" });
  const out = [];
  for (const c of CASES) out.push(await runCase(page, c));
  await browser.close();
  return { browser: name, version, cases: out };
}

async function main() {
  const only = typeof args.browser === "string" ? [args.browser] : Object.keys(LAUNCHERS);
  // 🔴 単一ブラウザ指定のときは他ブラウザの生ファイルを消さない（追記型の集計）
  if (typeof args.browser !== "string" && existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  for (const name of only) {
    const r = await runBrowser(name);
    writeFileSync(join(OUT, `cases.${name}.json`), JSON.stringify(r, null, 2) + "\n");
    console.log(`[${name}] ${r.version} — 測定完了`);
  }

  // --- 集計（生ファイルから読み直す。測ったのに集計に入らない経路を作らない）---
  const files = readdirSync(OUT).filter((f) => /^cases\.(chromium|firefox|webkit)\.json$/.test(f));
  const perBrowser = files.map((f) => JSON.parse(readFileSync(join(OUT, f), "utf8")));
  perBrowser.sort((a, b) => a.browser.localeCompare(b.browser));

  const lines = [
    `# ${ID} (M2)`,
    `measured-at: ${new Date().toISOString()}`,
    `page-origin: ${ORIGIN}`,
    `browsers: ${perBrowser.map((b) => `${b.browser} ${b.version}`).join(" / ")}`,
    "",
    "判定はサーバ側の到着記録。OPTIONS（preflight）は除いて数える。",
    "",
  ];

  const summary = { scenario: ID, mode: "M2", browsers: {} };
  for (const b of perBrowser) summary.browsers[b.browser] = b.version;

  for (const c of CASES) {
    const row = perBrowser.map((b) => b.cases.find((x) => x.id === c.id));
    const auths = row.map((r) => r?.auth ?? "unreached");
    const agree = new Set(auths).size === 1;
    lines.push(
      `${c.id.padEnd(3)} ${c.desc.padEnd(30)} ` +
        perBrowser.map((b, i) => `${b.browser}=${auths[i]}`).join(" ") +
        `  ${agree ? "一致" : "🔴 乖離"}`
    );
    summary[`${c.id}_auth`] = agree ? auths[0] : auths;
    summary[`${c.id}_engines_agree`] = agree;
    summary[`${c.id}_preflight_max`] = Math.max(...row.map((r) => r?.preflight_count ?? 0));
    // 🔴 エンジンごとの preflight 回数も残す。max だけだと「Chromium が 1 回も出さない」を
    //    記事に書いても突合できない。
    perBrowser.forEach((b, i) => {
      summary[`${c.id}_preflight_${b.browser}`] = row[i]?.preflight_count ?? null;
    });
    lines.push(
      `    preflight: ` + perBrowser.map((b, i) => `${b.browser}=${row[i]?.preflight_count ?? "-"}`).join(" ")
    );
  }

  const arrived = CASES.filter((c) => summary[`${c.id}_auth`] === "yes").map((c) => c.id);
  summary.arrived_cases = arrived;
  summary.arrived_count = arrived.length;
  summary.cases_total = CASES.length;
  summary.all_engines_agree = CASES.every((c) => summary[`${c.id}_engines_agree`]);

  lines.push(
    "",
    `全 ${CASES.length} ケース中、Authorization が終端まで届いたのは ${arrived.length} 件: ${arrived.join(", ") || "なし"}`,
    `3 エンジンの判定は${summary.all_engines_agree ? "すべて一致" : "🔴 一部が乖離"}`
  );

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(lines.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
