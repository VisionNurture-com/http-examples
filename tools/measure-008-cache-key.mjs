#!/usr/bin/env node
// measure-008-cache-key.mjs — preflight キャッシュの鍵の粒度を測る（M2・実ブラウザ）
//
// 仕様（WHATWG Fetch / CORS-preflight cache）では、エントリの鍵は
//   network partition key / byte-serialized origin / URL / credentials / method / header name
// で、しかもエントリは「レスポンスの Access-Control-Allow-Methods / -Headers に
// 列挙された分」だけ作られる。リクエストが要求した分ではない。
//
// そこで応答を 2 系統に分けて測る:
//   fixed — 要求に関係なく広く列挙する
//   echo  — 要求されたものだけを返す
//
// 判定はサーバ側の OPTIONS 到着記録（results/008-cache-key/preflight.log）で行う。
// 1 ケースにつき、1 回目 → 3 秒待つ → 2 回目 を同一コンテキストで送り、
// 到着が 1 件なら「2 回目はキャッシュに当たった」、2 件なら「別エントリ扱い」。
//
// 🔴 max-age は 30 秒。3 秒後の 2 回目が飛んだ場合、それは期限切れではなく
//    鍵の違いによるものだと言える。
// 🔴 判定は生ログのカウントのみで機械的に行う。予測と食い違ってもそのまま記録する。
//
// 使い方: node tools/measure-008-cache-key.mjs [--browser=chromium|firefox|webkit|all]
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
// logLineCount は本ファイル内に同名の実装があるためそれを使う
import { assertLogChannelLive } from "./log-channel.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "008-cache-key");
const LOG = join(OUT, "preflight.log");
const RUNLOG = join(OUT, "run.log");
const PAGE = "http://localhost:8080/008/";
const API = "http://localhost:8081";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const LAUNCHERS = { chromium, firefox, webkit };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1 ケース = 2 回のリクエスト。2 回目で OPTIONS が届くかを見る。
// path は API 直下の相対パス。<PREFIX> は実行時にケース固有の接頭辞へ置換する。
const CASES = [
  {
    id: "K0", desc: "完全に同一のリクエストを 2 回",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
  {
    id: "K1", desc: "パスを変える",
    a: { path: "/p1", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p2", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
  {
    id: "K2", desc: "クエリだけ変える",
    a: { path: "/p?x=1", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p?x=2", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
  {
    id: "K3", desc: "メソッドを変える（PUT → DELETE）",
    a: { path: "/p", method: "PUT", headers: {}, creds: "omit" },
    b: { path: "/p", method: "DELETE", headers: {}, creds: "omit" },
  },
  {
    id: "K4", desc: "独自ヘッダを増やす（x-probe → x-probe, x-extra）",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1", "x-extra": "1" }, creds: "omit" },
  },
  {
    id: "K5", desc: "独自ヘッダを減らす（x-probe, x-extra → x-probe）",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1", "x-extra": "1" }, creds: "omit" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
  {
    id: "K6", desc: "credentials なし → include",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "include" },
  },
  {
    id: "K7", desc: "credentials include → なし",
    a: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "include" },
    b: { path: "/p", method: "GET", headers: { "x-probe": "1" }, creds: "omit" },
  },
];

const SYSTEMS = ["fixed", "echo"];

/** ログの現在行数（この時点以降に増えた分だけを数えるため） */
function logLineCount() {
  if (!existsSync(LOG)) return 0;
  return readFileSync(LOG, "utf8").split("\n").filter(Boolean).length;
}

/** from 行目以降で、prefix 宛の OPTIONS 到着を数える */
function countOptionsSince(from, prefix) {
  if (!existsSync(LOG)) return 0;
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(from)
    .filter((l) => l.includes(" OPTIONS ") && l.includes(prefix))
    .length;
}

async function runRequest(page, url, req) {
  return page.evaluate(
    async ({ url, method, headers, creds }) => {
      try {
        const res = await fetch(url, { method, headers, credentials: creds });
        return { ok: true, status: res.status };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    },
    { url, method: req.method, headers: req.headers, creds: req.creds }
  );
}

async function measureCase(launcher, browserName, system, c) {
  const browser = await launcher.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(PAGE);

  const prefix = `/008/cachekey/${system}/${browserName}/${c.id}`;
  const before = logLineCount();

  const ra = await runRequest(page, `${API}${prefix}${c.a.path}`, c.a);
  // ログが書き出されるまでの猶予 + キャッシュ有効期間内で 2 回目を送る
  await sleep(3000);
  const mid = logLineCount();
  const rb = await runRequest(page, `${API}${prefix}${c.b.path}`, c.b);
  await sleep(1500);

  // before〜mid = 1 回目の到着 / mid〜末尾 = 2 回目の到着
  const firstOnly = countOptionsSince(before, prefix) - countOptionsSince(mid, prefix);
  const secondOnly = countOptionsSince(mid, prefix);

  await context.close();
  await browser.close();

  return {
    case: c.id,
    desc: c.desc,
    system,
    browser: browserName,
    preflight_first: firstOnly,
    preflight_second: secondOnly,
    second_fired: secondOnly > 0,
    first_result: ra,
    second_result: rb,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // 観測チャネル（サーバ側の到着記録）の生死は測定の前提
  const logBefore = logLineCount();

  // 🔴 M2 は CI で回らないため、実施条件を run.log に残す（check-provenance が先頭 10 行を検査する）
  const header = [
    `measured-at: ${new Date().toISOString()}`,
    `scenario: 008-cache-key`,
    "mode: M2",
    `page-origin: ${PAGE}`,
    `api-origin: ${API}`,
    `judgement: サーバ側の OPTIONS 到着記録（生ログのカウントのみ・予測は入れない）`,
    "---",
  ].join("\n") + "\n";
  appendFileSync(RUNLOG, header);

  const want = args.browser === "all" || !args.browser
    ? ["chromium", "firefox", "webkit"]
    : [String(args.browser)];

  const rows = [];
  for (const browserName of want) {
    const launcher = LAUNCHERS[browserName];
    if (!launcher) throw new Error(`unknown browser: ${browserName}`);
    for (const system of SYSTEMS) {
      for (const c of CASES) {
        const r = await measureCase(launcher, browserName, system, c);
        rows.push(r);
        appendFileSync(RUNLOG, JSON.stringify(r) + "\n");
        console.log(
          `${browserName.padEnd(8)} ${system.padEnd(5)} ${r.case} ` +
            `1回目=${r.preflight_first} 2回目=${r.preflight_second} ` +
            `→ ${r.second_fired ? "飛んだ" : "飛ばない"}  ${r.desc}`
        );
      }
    }
  }

  // 書き出す前に観測チャネルの生死を確かめる（死んでいれば到着 0 件が偽の測定値になる）
  assertLogChannelLive(LOG, logBefore, "008-cache-key");

  // エンジンごとに別ファイルへ書く（1 エンジンずつ実行しても上書きしないため）
  for (const browserName of want) {
    const subset = rows.filter((r) => r.browser === browserName);
    writeFileSync(
      join(OUT, `raw.${browserName}.json`),
      JSON.stringify(subset, null, 2) + "\n"
    );
  }
  console.log(`\n${rows.length} 件を results/008-cache-key/raw.<browser>.json に保存しました。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
