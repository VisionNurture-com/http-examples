#!/usr/bin/env node
// measure-012-early-hints-enabled.mjs — nginx に early_hints を書くと 103 が客まで届くか（M2）
//
// 測るもの:
//   012-early-hints は「early_hints を書かない既定」で 18 通りを測り、nginx が上流の 103 を
//   落とすことを示した。本シナリオはその続きで、**書いたときに何が変わるか**だけを見る。
//
// 🔴 既定側の測定を壊さないため、`/012/eh`（既定）には手を触れない。
//    `/012/ehon` を別に用意し、違いを nginx の `early_hints` 1 行だけにしてある。
//
// 🔴 見るのは 2 つ。「103 が届くか」と「届いた結果、画面に要る資源が早く来るか」。
//    前者だけを見ると、報告 TTFB が下がったことを改善と読み違える。
//
// 使い方: node tools/measure-012-early-hints-enabled.mjs
// 出力  : results/012-early-hints-enabled/run.log + summary.json

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "results", "012-early-hints-enabled");

const BASE = "https://localhost:8445";
const THINK_MS = 200;
const CC = "no-store";
const WARMUP = 1; // 1 回目は接続の確立が乗るため捨てる
const SAMPLES = 3;

const CASES = [
  { key: "default", path: "/012/eh", label: "既定（early_hints を書かない）" },
  { key: "enabled", path: "/012/ehon", label: "early_hints を書いた" },
];

const ENGINES = [
  { name: "chrome", launch: () => chromium.launch({ channel: "chrome" }) },
  { name: "firefox", launch: () => firefox.launch() },
  { name: "webkit", launch: () => webkit.launch() },
];

const median = (a) => {
  const s = a.filter((x) => x != null).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

const lines = [];
const log = (s) => {
  console.log(s);
  lines.push(s);
};

log(`measured-at: ${new Date().toISOString()}`);
log(`base=${BASE} think_ms=${THINK_MS} cache-control=${CC} warmup=${WARMUP} samples=${SAMPLES}`);
log("");

const engines = {};

for (const eng of ENGINES) {
  const browser = await eng.launch();
  const version = browser.version();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  engines[eng.name] = { version, cases: {} };

  for (const c of CASES) {
    const samples = [];
    for (let i = 0; i < WARMUP + SAMPLES; i++) {
      const url = `${BASE}${c.path}?hints=preload&ms=${THINK_MS}&cc=${encodeURIComponent(CC)}&n=${Date.now()}-${i}`;
      await page.goto(url, { waitUntil: "load" });
      const v = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        const css = performance
          .getEntriesByType("resource")
          .find((r) => r.name.includes("eh-asset.css"));
        return {
          interim: n.firstInterimResponseStart,
          ttfb: n.responseStart - n.startTime,
          final: n.finalResponseHeadersStart,
          css_end: css ? css.responseEnd : null,
          proto: n.nextHopProtocol,
        };
      });
      if (i >= WARMUP) samples.push(v);
    }

    const rec = {
      label: c.label,
      path: c.path,
      protocol: samples[0].proto,
      // 103 が「届いた」判定は、全サンプルで到着時刻が 0 より大きいこと
      interim_delivered: samples.every((s) => s.interim > 0),
      interim_ms: median(samples.map((s) => s.interim)),
      reported_ttfb_ms: median(samples.map((s) => s.ttfb)),
      final_headers_ms: median(samples.map((s) => s.final)),
      css_response_end_ms: median(samples.map((s) => s.css_end)),
    };
    engines[eng.name].cases[c.key] = rec;

    log(
      `${eng.name.padEnd(8)} ${c.key.padEnd(8)} proto=${rec.protocol} 103届く=${rec.interim_delivered ? "YES" : "no "} ` +
        `103到着=${rec.interim_ms?.toFixed(1)} 報告TTFB=${rec.reported_ttfb_ms?.toFixed(1)} ` +
        `最終ヘッダ=${rec.final_headers_ms?.toFixed(1)} CSS到着=${rec.css_response_end_ms?.toFixed(1)}`,
    );
  }
  await browser.close();
}

// --- 読み取り ---
const names = Object.keys(engines);
const defaultDelivers = names.some((n) => engines[n].cases.default.interim_delivered);
const enabledDelivers = names.every((n) => engines[n].cases.enabled.interim_delivered);

// 「早まったか」は CSS の到着で判定する（報告 TTFB では判定できない）
const cssHelps = {};
for (const n of names) {
  const d = engines[n].cases.default.css_response_end_ms;
  const e = engines[n].cases.enabled.css_response_end_ms;
  // 10% 以上短くなったときだけ「早まった」とする（測定の揺れを跨がせない）
  cssHelps[n] = d != null && e != null ? e < d * 0.9 : null;
}

// WebKit は 103 があると最終ヘッダが最初の応答と同値になり分離できない
const webkitCannotSeparate =
  engines.webkit.cases.enabled.final_headers_ms != null &&
  engines.webkit.cases.enabled.interim_ms != null &&
  Math.abs(engines.webkit.cases.enabled.final_headers_ms - engines.webkit.cases.enabled.interim_ms) < 1;

log("");
log(`既定で 103 が届いたエンジン: ${defaultDelivers ? "あり" : "なし"}`);
log(`early_hints を書くと全エンジンで届く: ${enabledDelivers ? "YES" : "no"}`);
for (const n of names) log(`  ${n}: 資源の到着が早まったか = ${cssHelps[n] ? "YES" : "no"}`);
log(`webkit は最終ヘッダを分離できるか: ${webkitCannotSeparate ? "できない" : "できる"}`);

const summary = {
  scenario: "012-early-hints-enabled",
  mode: "M2",
  measured_at: new Date().toISOString(),
  base: BASE,
  think_ms: THINK_MS,
  cache_control: CC,
  samples: SAMPLES,
  engines_measured: names.length,
  default_delivers_interim: defaultDelivers,
  enabled_delivers_interim: enabledDelivers,
  css_arrives_earlier_when_enabled: cssHelps,
  webkit_cannot_separate_final_headers_via_nginx: webkitCannotSeparate,
  engines,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "run.log"), lines.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
log("");
log(`生ログ: results/012-early-hints-enabled/run.log`);
