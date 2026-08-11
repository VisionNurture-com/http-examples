#!/usr/bin/env node
// measure-008-redirect.mjs — リダイレクトを挟むと CORS がどう壊れるか（M2・実ブラウザ）
//
// 「ローカルでは通るのに本番だけ落ちる」の典型を再現する。本番の前に
// リバースプロキシや末尾スラッシュ補完の 301 が入ると挙動が変わる。
//
// 🔴 仕様（WHATWG Fetch）で確認済みの 2 点を実装が守っているかを見る。
//   ① preflight のエントリ作成条件は
//      「CORS check が成功し、かつ response's status is an ok status」→ 301 は ok status ではない
//   ② クロスオリジンのリダイレクトが起きた時点で Authorization は削除される
//      （原文: I.e., the moment another origin is seen after the initial request,
//        the `Authorization` header is removed.）
//
// 判定は 2 系統。ブラウザ側の fetch 結果 + サーバ側の到着記録
// （第 3 オリジンには auth=yes/no だけを記録する。値そのものは残さない）。
//
// 使い方: node tools/measure-008-redirect.mjs [--browser=chromium|firefox|webkit]
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logLineCount, assertLogChannelLive } from "./log-channel.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "008-redirect");
const LOG = join(OUT, "preflight.log");
const THIRD_LOG = join(OUT, "third-origin.log");
const RUNLOG = join(OUT, "run.log");
const PAGE = "http://localhost:8080/008/";
const API = "http://localhost:8081";

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
    id: "R0", path: "/008/redirect/direct", method: "GET",
    headers: { authorization: TOKEN },
    desc: "リダイレクトなし（対照）",
  },
  {
    id: "R1", path: "/008/redirect/simple", method: "GET",
    headers: {},
    desc: "単純リクエストが同一オリジン内で 301",
  },
  {
    id: "R2", path: "/008/redirect/preflighted", method: "PUT",
    headers: { authorization: TOKEN },
    desc: "preflight を伴うリクエストの本番送信が 301",
  },
  {
    id: "R3", path: "/008/redirect/optionsredirect", method: "PUT",
    headers: { authorization: TOKEN },
    desc: "preflight（OPTIONS）自体が 301 を返す",
  },
  {
    id: "R4", path: "/008/redirect/crossorigin", method: "PUT",
    headers: { authorization: TOKEN },
    desc: "別オリジン（:8083）へリダイレクト + Authorization",
  },
];

function lineCount(file) {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8").split("\n").filter(Boolean).length;
}

function linesSince(file, from) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).slice(from);
}

async function measureCase(launcher, browserName, c) {
  const browser = await launcher.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(PAGE);

  const beforeApi = lineCount(LOG);
  const beforeThird = lineCount(THIRD_LOG);

  const result = await page.evaluate(
    async ({ url, method, headers }) => {
      try {
        const res = await fetch(url, { method, headers });
        return { ok: true, status: res.status, redirected: res.redirected, url: res.url };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    },
    { url: `${API}${c.path}`, method: c.method, headers: c.headers }
  );

  await sleep(1500);

  const apiLines = linesSince(LOG, beforeApi);
  const thirdLines = linesSince(THIRD_LOG, beforeThird);
  const optionsCount = apiLines.filter((l) => l.includes(" OPTIONS ")).length;

  // 第 3 オリジンには preflight（OPTIONS）も届く。両方を数える。
  const thirdPreflights = thirdLines.filter((l) => l.includes(" OPTIONS "));
  const thirdActual = thirdLines.filter((l) => !l.includes(" OPTIONS "));
  const field = (line, key) => {
    const m = line.match(new RegExp(`${key}=(\\S+)`));
    return m ? m[1] : null;
  };
  // 🔴 リダイレクト後にブラウザが送る Origin を記録する。null になると
  //    サーバが具体的なオリジンを返す設定では CORS チェックに通らない。
  const originsSeen = [...new Set(thirdLines.map((l) => field(l, "origin")).filter(Boolean))];
  const authOnThird = thirdActual.length === 0
    ? null
    : thirdActual.some((l) => field(l, "auth") === "yes");

  await context.close();
  await browser.close();

  return {
    case: c.id,
    desc: c.desc,
    browser: browserName,
    fetch_ok: result.ok,
    fetch: result,
    preflight_count: optionsCount,
    third_origin_preflights: thirdPreflights.length,
    third_origin_actual: thirdActual.length,
    third_origin_origins: originsSeen,
    authorization_survived_redirect: authOnThird,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // 観測チャネル（サーバ側の到着記録）の生死は測定の前提
  const logBefore = logLineCount(LOG);

  // 🔴 M2 は CI で回らないため、実施条件を run.log に残す（check-provenance が先頭 10 行を検査する）
  const header = [
    `measured-at: ${new Date().toISOString()}`,
    `scenario: 008-redirect`,
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
      const auth =
        r.authorization_survived_redirect === null
          ? "-"
          : r.authorization_survived_redirect ? "残った" : "消えた";
      appendFileSync(RUNLOG, JSON.stringify(r) + "\n");
      console.log(
        `${browserName.padEnd(8)} ${r.case} fetch=${r.fetch_ok ? "成功" : "失敗"} ` +
          `preflight=${r.preflight_count} 第3オリジン(OPTIONS=${r.third_origin_preflights}/本番=${r.third_origin_actual}) ` +
          `Origin=${r.third_origin_origins.join(",") || "-"} Authorization=${auth}  ${r.desc}`
      );
      if (!r.fetch_ok) console.log(`         └ ${r.fetch.error}`);
    }
  }

  // 書き出す前に観測チャネルの生死を確かめる（死んでいれば到着 0 件が偽の測定値になる）
  assertLogChannelLive(LOG, logBefore, "008-redirect");

  for (const browserName of want) {
    writeFileSync(
      join(OUT, `raw.${browserName}.json`),
      JSON.stringify(rows.filter((r) => r.browser === browserName), null, 2) + "\n"
    );
  }
  console.log(`\n${rows.length} 件を results/008-redirect/raw.<browser>.json に保存しました。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
