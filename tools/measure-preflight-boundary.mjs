#!/usr/bin/env node
// measure-preflight-boundary.mjs — preflight がどこから飛ぶかを測る（M2・実ブラウザ）
//
// 「単純リクエスト」の条件を満たすかどうかで preflight の有無が変わる。
// 条件は仕様に書かれているが、Content-Type の値ひとつで境界をまたぐため、
// 読者が copy-paste した設定で意図せず preflight が増える。実際に測って確かめる。
//
// 判定はサーバ側の到着記録（preflight.log）で行う。各ケースは別パスを使い、
// ブラウザのコンテキストも毎回作り直すので、キャッシュの影響を受けない。
//
// 使い方: node tools/measure-preflight-boundary.mjs --browser=chromium

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logLineCount, assertLogChannelLive } from "./log-channel.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "008-preflight-boundary");
const PREFLIGHT_LOG = join(ROOT, "results", "008-cors-max-age", "preflight.log");
const PAGE = "http://localhost:8080/008/";
const API = "http://localhost:8081";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const browserName = args.browser ?? "chromium";
const LAUNCHERS = { chromium, firefox, webkit };

// 各ケースは「読者が実際に書くコード」の形にする。
const CASES = [
  { id: "get-plain", desc: "GET・独自ヘッダなし", method: "GET", headers: {}, body: null },
  { id: "get-custom-header", desc: "GET・独自ヘッダ x-probe あり", method: "GET", headers: { "x-probe": "1" }, body: null },
  { id: "post-text-plain", desc: "POST・Content-Type: text/plain", method: "POST", headers: { "content-type": "text/plain" }, body: "hello" },
  { id: "post-form-urlencoded", desc: "POST・Content-Type: application/x-www-form-urlencoded", method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1" },
  { id: "post-multipart", desc: "POST・Content-Type: multipart/form-data", method: "POST", headers: { "content-type": "multipart/form-data; boundary=X" }, body: "--X--" },
  { id: "post-json", desc: "POST・Content-Type: application/json", method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' },
  { id: "put-plain", desc: "PUT・独自ヘッダなし", method: "PUT", headers: {}, body: "x" },
  { id: "delete-plain", desc: "DELETE・独自ヘッダなし", method: "DELETE", headers: {}, body: null },
];

function countArrivals(uri) {
  if (!existsSync(PREFLIGHT_LOG)) return 0;
  return readFileSync(PREFLIGHT_LOG, "utf8")
    .split("\n")
    .filter((l) => l.includes(" OPTIONS ") && l.includes(` ${uri} `)).length;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // 観測チャネルの生死は測定の前提。死んでいれば全ケースが偽の「preflight なし」になる。
  const logBefore = logLineCount(PREFLIGHT_LOG);

  const launcher = LAUNCHERS[browserName];
  const browser = await launcher.launch();
  const version = browser.version();
  const results = [];

  for (const c of CASES) {
    const uri = `/008/boundary/${c.id}`;
    const before = countArrivals(uri);

    // ケースごとにまっさらなコンテキスト。前のケースのキャッシュを持ち込まない。
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });

    const res = await page.evaluate(
      async ({ api, uri, method, headers, body }) => {
        try {
          const r = await fetch(api + uri, { method, headers, body: body ?? undefined });
          return { ok: true, status: r.status };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      },
      { api: API, uri, method: c.method, headers: c.headers, body: c.body }
    );

    await context.close();
    await new Promise((r) => setTimeout(r, 300)); // ログの書き出しを待つ

    const after = countArrivals(uri);
    const preflighted = after - before > 0;

    results.push({
      id: c.id,
      description: c.desc,
      method: c.method,
      request_headers: c.headers,
      preflighted,
      response_ok: res.ok,
      response_status: res.status ?? null,
    });
    console.log(`  ${preflighted ? "preflight あり" : "preflight なし"}  ${c.id}（${c.desc}）`);
  }

  await browser.close();

  // 書き出す前に確かめる。増えていなければ結果は観測失敗であって測定値ではない。
  assertLogChannelLive(PREFLIGHT_LOG, logBefore, `boundary/${browserName}`);

  const summary = {
    browser: browserName,
    browser_version: version,
    measured_at: new Date().toISOString(),
    cases: results,
    preflighted_count: results.filter((r) => r.preflighted).length,
  };

  writeFileSync(join(OUT, `boundary.${browserName}.json`), JSON.stringify(summary, null, 2) + "\n");
  appendFileSync(
    join(OUT, "run.log"),
    [
      `measured-at: ${summary.measured_at}`,
      `browser: ${browserName} ${version}`,
      ...results.map((r) => `  ${r.preflighted ? "preflight あり" : "preflight なし"}  ${r.id} — ${r.description} -> ${r.response_status}`),
      "---",
      "",
    ].join("\n")
  );

  console.log(`[boundary/${browserName} ${version}] preflight あり ${summary.preflighted_count} / ${results.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
