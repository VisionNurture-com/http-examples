#!/usr/bin/env node
// measure-012-lighthouse-ttfb.mjs — Lighthouse の「サーバ応答時間」は 103 で何を返すか（M1）
//
// 測るもの:
//   012-timing-api は、ブラウザが報告する TTFB と web-vitals が返す値が、どちらも
//   103 の到着時刻で決まることを示した。本シナリオはその続きで、**監査ツールの側**を見る。
//
//   Lighthouse の `server-response-time`（レポート上は "Root document took N ms"）は
//   サーバの応答が遅いかどうかの指摘に使われる。この値が 103 で動くなら、
//   「監査ツールのスコアが良くなった」も改善の証拠にならない。
//
// 🔴 見るのは 2 つ。「server-response-time が動くか」と「画面の指標（FCP / LCP）も動くか」。
//    前者だけが動いて後者が動かないなら、変わったのは測り方であって速さではない。
//
// 🔴 アプリへ直結して測る。nginx は既定で 103 を落とすため（012-early-hints）、
//    経路に挟むと「103 あり」の条件を作れない。
//
// 使い方: node tools/measure-012-lighthouse-ttfb.mjs
// 出力  : results/012-lighthouse-ttfb/run.log + summary.json

import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "results", "012-lighthouse-ttfb");

const BASE = "http://localhost:8086";
const THINK_MS = 200;
const CC = "no-store";
const SAMPLES = 3;

const CASES = [
  { key: "none", hints: "none", label: "103 を送らない（対照）" },
  { key: "preload", hints: "preload", label: "103 で実際に使う資源を先読みさせる" },
];

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

function runLighthouse(url, outPath) {
  execFileSync(
    "npx",
    [
      "--yes",
      "lighthouse",
      url,
      "--only-categories=performance",
      "--output=json",
      `--output-path=${outPath}`,
      "--chrome-flags=--headless=new --no-sandbox",
      "--quiet",
      "--max-wait-for-load=20000",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  return JSON.parse(readFileSync(outPath, "utf8"));
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

log("# 012-lighthouse-ttfb — Lighthouse のサーバ応答時間は 103 で何を返すか");
log(`base=${BASE} think_ms=${THINK_MS} cache_control=${CC} samples=${SAMPLES}`);
log("");

const cases = {};
let lighthouseVersion = null;

for (const c of CASES) {
  const url = `${BASE}/012/eh?hints=${c.hints}&ms=${THINK_MS}&cc=${CC}`;
  const srt = [];
  const fcp = [];
  const lcp = [];
  let runtimeError = null;

  log(`## ${c.label}`);
  log(`   ${url}`);

  for (let i = 1; i <= SAMPLES; i++) {
    const tmp = join(tmpdir(), `lh-012-${c.key}-${i}.json`);
    const d = runLighthouse(url, tmp);
    rmSync(tmp, { force: true });
    lighthouseVersion ??= d.lighthouseVersion;
    if (d.runtimeError) runtimeError = d.runtimeError.code;
    const a = d.audits;
    srt.push(Math.round(a["server-response-time"].numericValue));
    fcp.push(Math.round(a["first-contentful-paint"].numericValue));
    lcp.push(Math.round(a["largest-contentful-paint"].numericValue));
    log(
      `   #${i} server-response-time=${srt.at(-1)}ms ` +
        `first-contentful-paint=${fcp.at(-1)}ms largest-contentful-paint=${lcp.at(-1)}ms`,
    );
  }

  cases[c.key] = {
    label: c.label,
    url,
    runtime_error: runtimeError,
    server_response_time_ms: srt,
    server_response_time_median_ms: median(srt),
    first_contentful_paint_median_ms: median(fcp),
    largest_contentful_paint_median_ms: median(lcp),
  };
  log("");
}

// 判定 1: server-response-time が 103 で落ちるか（対照の 1/10 未満なら「落ちる」）
const srtNone = cases.none.server_response_time_median_ms;
const srtPreload = cases.preload.server_response_time_median_ms;
const srtCollapses = srtPreload * 10 < srtNone;

// 判定 2: 画面の指標も一緒に動くか（10% 以上の変化があれば「動いた」）
const lcpNone = cases.none.largest_contentful_paint_median_ms;
const lcpPreload = cases.preload.largest_contentful_paint_median_ms;
const paintImproves = Math.abs(lcpPreload - lcpNone) / lcpNone >= 0.1;

// 判定 3: 103 を送るとレポートが壊れるか（2021 の既知報告 NOT_HTML の再現確認）
const reportBreaks = cases.preload.runtime_error != null;

log(`server-response-time: ${srtNone}ms（103 なし）→ ${srtPreload}ms（103 あり）`);
log(`server-response-time は 103 で落ちるか: ${srtCollapses ? "YES" : "no"}`);
log(`largest-contentful-paint: ${lcpNone}ms → ${lcpPreload}ms`);
log(`画面の指標も動いたか: ${paintImproves ? "YES" : "no"}`);
log(`103 でレポートが壊れるか: ${reportBreaks ? `YES (${cases.preload.runtime_error})` : "no"}`);

const summary = {
  scenario: "012-lighthouse-ttfb",
  mode: "M1",
  measured_at: new Date().toISOString(),
  base: BASE,
  think_ms: THINK_MS,
  cache_control: CC,
  samples: SAMPLES,
  lighthouse_version: lighthouseVersion,
  server_response_time_collapses_with_interim: srtCollapses,
  paint_metrics_improve_with_interim: paintImproves,
  report_breaks_with_interim: reportBreaks,
  cases,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "run.log"), lines.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log("");
console.log("生ログ: results/012-lighthouse-ttfb/run.log");
console.log("実効値: results/012-lighthouse-ttfb/summary.json");
