#!/usr/bin/env node
// measure-012-early-hints.mjs — 「TTFB が下がった」の見かけと実際を分けて測る（M2）
//
// 測るもの（1 回のナビゲーションで 4 つの時刻を同時に取る）:
//   startTime                  … 起点
//   responseStart              … 最初の応答（103 があればその時刻）
//   firstInterimResponseStart  … 中間応答（103）の時刻。無ければ 0
//   finalResponseHeadersStart  … 最終ヘッダ（200）の時刻
//   Server-Timing の app;dur   … サーバが実際に費やした時間
//
// 🔴 報告 TTFB（responseStart − startTime）が下がっても、サーバの実処理時間は変わらない。
//    両方を同じ 1 回の遷移から取らないと、この 2 つを混同したまま「速くなった」と読める。
//
// アーム:
//   transport = direct … アプリへ直結（nginx なし）。103 は必ず出る
//   transport = nginx  … nginx 経由。上流の 103 を通すかどうかがここで出る
//   hints     = none / bare / preload
//     none    … 103 を送らない（対照）
//     bare    … 103 は送るが、その回の描画に効かないものしか載せない
//     preload … 103 で実際に使う資源を先読みさせる
//
// 使い方: node tools/measure-012-early-hints.mjs [--engine=chrome] [--repeat=5]
// 出力  : results/012-early-hints/{run.log,browser-<engine>.json}

import { writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "results", "012-early-hints");

const TRANSPORTS = {
  direct: { base: "http://localhost:8086", note: "アプリへ直結（HTTP/1.1・平文）" },
  h2direct: { base: "https://localhost:8447", note: "HTTP/2 + TLS で 103 を出す直結" },
  nginx: { base: "https://localhost:8445", note: "nginx 経由（HTTP/2・TLS）" },
};
const HINTS = ["none", "bare", "preload"];
const THINK_MS = 200;

// RUM ライブラリの実物。バンドル済みの IIFE をページへ差し込んで、返る値をそのまま読む
const WEB_VITALS_IIFE = readFileSync(join(ROOT, "node_modules", "web-vitals", "dist", "web-vitals.iife.js"), "utf8");
const WEB_VITALS_VERSION = JSON.parse(
  readFileSync(join(ROOT, "node_modules", "web-vitals", "package.json"), "utf8")
).version;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const ENGINES = {
  chrome: { launcher: chromium, opts: { channel: "chrome" } },
  chromium: { launcher: chromium, opts: {} },
  firefox: { launcher: firefox, opts: {} },
  webkit: { launcher: webkit, opts: {} },
};

const engineName = args.engine ?? "chrome";
const engine = ENGINES[engineName];
if (!engine) {
  console.error(`不明なエンジン: ${engineName}（${Object.keys(ENGINES).join(" / ")}）`);
  process.exit(3);
}
const repeat = Number(args.repeat ?? 5);

const profileDir = join(tmpdir(), `http-examples-012eh-${engineName}`);
rmSync(profileDir, { recursive: true, force: true });
const context = await engine.launcher.launchPersistentContext(profileDir, engine.opts);
const browser = context.browser();
const version = browser ? browser.version() : "(persistent context)";
const page = context.pages()[0] ?? (await context.newPage());

/** 1 回のナビゲーションから 4 つの時刻を取る */
async function once(base, hints, cc, nonce) {
  const url = `${base}/012/eh?hints=${hints}&ms=${THINK_MS}&cc=${encodeURIComponent(cc)}&n=${nonce}`;
  await page.goto("about:blank");
  await page.goto(url, { waitUntil: "load" });
  // 🔴 RUM ライブラリが返す値も同じ遷移から取る。式を自分で書き直すと
  //    「ライブラリがどちらの定義を使っているか」の検証にならない
  let webVitalsTtfb = null;
  try {
    await page.addScriptTag({ content: WEB_VITALS_IIFE });
    webVitalsTtfb = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const t = setTimeout(() => resolve(null), 3000);
          webVitals.onTTFB((m) => {
            clearTimeout(t);
            resolve(m.value);
          });
        })
    );
  } catch {
    webVitalsTtfb = null;
  }

  return page.evaluate((wv) => {
    const n = performance.getEntriesByType("navigation")[0];
    if (!n) return null;
    const st = (n.serverTiming ?? []).find((s) => s.name === "app");
    // 🔴 実利得の軸。報告 TTFB が下がっても、描画に要る資源が揃う時刻が
    //    早くならなければ読者にとって何も速くなっていない
    const asset = performance.getEntriesByType("resource").find((r) => r.name.includes("eh-asset.css"));
    return {
      loadEventEnd: n.loadEventEnd,
      assetResponseEnd: asset ? asset.responseEnd : null,
      startTime: n.startTime,
      requestStart: n.requestStart,
      responseStart: n.responseStart,
      // 実装によっては未定義。0 と「無い」を分けるため null にする
      firstInterimResponseStart:
        "firstInterimResponseStart" in n ? n.firstInterimResponseStart : null,
      finalResponseHeadersStart:
        "finalResponseHeadersStart" in n ? n.finalResponseHeadersStart : null,
      serverTimingAppDur: st ? st.duration : null,
      serverTimingExposed: (n.serverTiming ?? []).length > 0,
      webVitalsTtfb: wv,
    };
  }, webVitalsTtfb);
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// 🔴 先読みした資源の Cache-Control を振る。「先読みが効かない」とき、
//    ブラウザが活かさないのか、保存できない応答なので取り直しているのかを分けるため
const CACHE_CONTROLS = ["no-store", "public, max-age=60"];

const rows = [];
for (const [transport, t] of Object.entries(TRANSPORTS)) {
  for (const cc of CACHE_CONTROLS) {
  for (const hints of HINTS) {
    const samples = [];
    // nonce は「経路・資源の CC・hints・試行番号」で一意にする。
    // 同じ URL を測り直すと、保存可能な資源が 2 回目以降キャッシュから返る
    for (let i = 0; i < repeat; i++) samples.push(await once(t.base, hints, cc, `${transport}-${cc}-${hints}-${i}`));
    const ok = samples.filter(Boolean);
    // 報告 TTFB = responseStart − startTime。ブラウザとツールが TTFB と呼ぶ値
    const reportedTtfb = ok.map((s) => s.responseStart - s.startTime);
    const finalHeaders = ok.map((s) =>
      s.finalResponseHeadersStart == null ? null : s.finalResponseHeadersStart - s.startTime
    );
    rows.push({
      transport,
      transport_note: t.note,
      asset_cache_control: cc,
      hints,
      n: ok.length,
      reported_ttfb_median_ms: Number((median(reportedTtfb) ?? 0).toFixed(1)),
      final_headers_median_ms: median(finalHeaders) == null ? null : Number(median(finalHeaders).toFixed(1)),
      server_think_median_ms:
        median(ok.map((s) => s.serverTimingAppDur)) == null
          ? null
          : Number(median(ok.map((s) => s.serverTimingAppDur)).toFixed(1)),
      // RUM ライブラリが返す TTFB。報告 TTFB と同じ値になるか、最終ヘッダ側を見ているか
      web_vitals_ttfb_median_ms:
        median(ok.map((s) => s.webVitalsTtfb)) == null
          ? null
          : Number(median(ok.map((s) => s.webVitalsTtfb)).toFixed(1)),
      // 実利得の軸。報告 TTFB が下がっても、ここが早くならなければ読者には何も起きていない
      asset_ready_median_ms: median(ok.map((s) => s.assetResponseEnd)),
      load_event_median_ms: median(ok.map((s) => s.loadEventEnd)),
      // 103 がブラウザまで届いたか。届いていれば中間応答の時刻が入る
      saw_interim: ok.some((s) => typeof s.firstInterimResponseStart === "number" && s.firstInterimResponseStart > 0),
      server_timing_exposed: ok.some((s) => s.serverTimingExposed),
      samples: ok,
    });
  }
  }
}

await context.close();

const payload = {
  measuredAt: new Date().toISOString(),
  engine: engineName,
  version,
  webVitalsVersion: WEB_VITALS_VERSION,
  thinkMs: THINK_MS,
  repeat,
  rows,
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, `browser-${engineName}.json`), JSON.stringify(payload, null, 2) + "\n");

if (!existsSync(join(OUT_DIR, "run.log"))) {
  writeFileSync(
    join(OUT_DIR, "run.log"),
    [
      `measured-at: ${payload.measuredAt}`,
      `scenario: 012-early-hints`,
      `mode: M2`,
      `judgement: 1 回の遷移から 報告TTFB / 最終ヘッダ / サーバ実処理時間 を同時に取る`,
      `---`,
      "",
    ].join("\n")
  );
}
for (const r of rows) {
  appendFileSync(join(OUT_DIR, "run.log"), JSON.stringify({ engine: engineName, version, ...r, samples: undefined }) + "\n");
}

console.log(`=== ${engineName} (version=${version}) / think=${THINK_MS}ms / n=${repeat} ===`);
console.log(`web-vitals ${WEB_VITALS_VERSION}`);
console.log("経路      資源のCC              hints     報告TTFB  最終ヘッダ  サーバ実処理  web-vitals  CSS到着  load完了  103");
for (const r of rows) {
  console.log(
    `${r.transport.padEnd(9)} ${r.asset_cache_control.padEnd(21)} ${r.hints.padEnd(9)} ` +
      `${String(r.reported_ttfb_median_ms).padStart(8)} ` +
      `${String(r.final_headers_median_ms ?? "-").padStart(11)} ` +
      `${String(r.server_think_median_ms ?? "-").padStart(12)} ` +
      `${String(r.web_vitals_ttfb_median_ms ?? "-").padStart(11)} ` +
      `${String(r.asset_ready_median_ms?.toFixed?.(1) ?? "-").padStart(8)} ` +
      `${String(r.load_event_median_ms?.toFixed?.(1) ?? "-").padStart(9)}  ${r.saw_interim ? "はい" : "いいえ"}`
  );
}
console.log(`\n生ログ: results/012-early-hints/run.log`);
