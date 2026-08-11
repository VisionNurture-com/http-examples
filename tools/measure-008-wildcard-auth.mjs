#!/usr/bin/env node
// measure-008-wildcard-auth.mjs — Access-Control-Allow-Headers の * と Authorization（M2・実ブラウザ）
//
// 仕様（WHATWG Fetch）では Authorization だけが「CORS non-wildcard request-header name」で、
//   - preflight 応答が * でも Authorization は覆われず network error になる
//   - * のキャッシュエントリは Authorization にマッチしない
// と定められている。実装が追随しているかを測る。
//
// 🔴 判定は 2 系統。
//   ① サーバ側の OPTIONS 到着記録 → preflight が飛んだか
//   ② ブラウザ側の fetch 結果      → 本番リクエストが通ったか
//   * + Authorization は「OPTIONS が届いたうえで応答検査に落ちる」ため、
//   ① だけでは判定できない。
//
// 使い方: node tools/measure-008-wildcard-auth.mjs [--browser=chromium|firefox|webkit]
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
// logLineCount は本ファイル内に同名の実装があるためそれを使う
import { assertLogChannelLive } from "./log-channel.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "008-wildcard-auth");
const LOG = join(OUT, "preflight.log");
const RUNLOG = join(OUT, "run.log");
const PAGE = "http://localhost:8080/008/";
const API = "http://localhost:8081";

// 実在しない合成トークン。値そのものはサーバのログに残さない（auth=yes/no のみ記録）。
const TOKEN = "Bearer test-token-for-measurement";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const LAUNCHERS = { chromium, firefox, webkit };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  {
    id: "W0", system: "explicit", desc: "Allow-Headers に authorization を明示列挙 + Authorization あり",
    headers: { authorization: TOKEN }, creds: "omit",
  },
  {
    id: "W1", system: "star", desc: "Allow-Headers が * + Authorization あり",
    headers: { authorization: TOKEN }, creds: "omit",
  },
  {
    id: "W2", system: "star", desc: "Allow-Headers が * + Authorization なし（x-probe のみ）",
    headers: { "x-probe": "1" }, creds: "omit",
  },
  {
    id: "W3", system: "credential", desc: "明示列挙 + Authorization あり + credentials: include",
    headers: { authorization: TOKEN }, creds: "include",
  },
];

function logLineCount() {
  if (!existsSync(LOG)) return 0;
  return readFileSync(LOG, "utf8").split("\n").filter(Boolean).length;
}

function countOptionsSince(from, prefix) {
  if (!existsSync(LOG)) return 0;
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(from)
    .filter((l) => l.includes(" OPTIONS ") && l.includes(prefix))
    .length;
}

async function runRequest(page, url, headers, creds) {
  return page.evaluate(
    async ({ url, headers, creds }) => {
      try {
        const res = await fetch(url, { method: "GET", headers, credentials: creds });
        return { ok: true, status: res.status };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    },
    { url, headers, creds }
  );
}

async function measureCase(launcher, browserName, c) {
  const browser = await launcher.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(PAGE);

  const prefix = `/008/wildcard/${c.system}/${browserName}/${c.id}`;
  const url = `${API}${prefix}/p`;
  const before = logLineCount();

  const first = await runRequest(page, url, c.headers, c.creds);
  await sleep(3000);
  const mid = logLineCount();
  const second = await runRequest(page, url, c.headers, c.creds);
  await sleep(1500);

  const firstPreflight = countOptionsSince(before, prefix) - countOptionsSince(mid, prefix);
  const secondPreflight = countOptionsSince(mid, prefix);

  await context.close();
  await browser.close();

  return {
    case: c.id,
    system: c.system,
    desc: c.desc,
    browser: browserName,
    preflight_first: firstPreflight,
    preflight_second: secondPreflight,
    fetch_first_ok: first.ok,
    fetch_first: first,
    fetch_second_ok: second.ok,
    fetch_second: second,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // 観測チャネル（サーバ側の到着記録）の生死は測定の前提
  const logBefore = logLineCount();

  // 🔴 M2 は CI で回らないため、実施条件を run.log に残す（check-provenance が先頭 10 行を検査する）
  const header = [
    `measured-at: ${new Date().toISOString()}`,
    `scenario: 008-wildcard-auth`,
    "mode: M2",
    `page-origin: ${PAGE}`,
    `api-origin: ${API}`,
    `judgement: サーバ側の OPTIONS 到着記録（生ログのカウントのみ・予測は入れない）`,
    "---",
  ].join("\n") + "\n";
  appendFileSync(RUNLOG, header);

  const want = args.browser ? [String(args.browser)] : ["chromium", "firefox", "webkit"];
  const rows = [];

  for (const browserName of want) {
    const launcher = LAUNCHERS[browserName];
    if (!launcher) throw new Error(`unknown browser: ${browserName}`);
    for (const c of CASES) {
      const r = await measureCase(launcher, browserName, c);
      rows.push(r);
      appendFileSync(RUNLOG, JSON.stringify(r) + "\n");
      console.log(
        `${browserName.padEnd(8)} ${r.case} preflight(1回目=${r.preflight_first} 2回目=${r.preflight_second}) ` +
          `fetch(1回目=${r.fetch_first_ok ? "成功" : "失敗"} 2回目=${r.fetch_second_ok ? "成功" : "失敗"})  ${r.desc}`
      );
      if (!r.fetch_first_ok) console.log(`         └ ${r.fetch_first.error}`);
    }
  }

  // 書き出す前に観測チャネルの生死を確かめる（死んでいれば到着 0 件が偽の測定値になる）
  assertLogChannelLive(LOG, logBefore, "008-wildcard-auth");

  for (const browserName of want) {
    writeFileSync(
      join(OUT, `raw.${browserName}.json`),
      JSON.stringify(rows.filter((r) => r.browser === browserName), null, 2) + "\n"
    );
  }
  console.log(`\n${rows.length} 件を results/008-wildcard-auth/raw.<browser>.json に保存しました。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
