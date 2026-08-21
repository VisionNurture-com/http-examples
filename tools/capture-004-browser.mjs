#!/usr/bin/env node
// capture-004-browser.mjs — 記事 004 のブラウザ側観測（M2・CI では回らない）
//
// 使い方:
//   node tools/capture-004-browser.mjs --scenario=004-browser-render
//   node tools/capture-004-browser.mjs --scenario=004-auth-browser
//   node tools/capture-004-browser.mjs --scenario=004-auth-headed
//   node tools/capture-004-browser.mjs --scenario=004-retry-browser
//
// 🔴 測れないものを測れたことにしない。
//    「401 でネイティブの認証ダイアログが出たか」は自動化ブラウザからは観測できない。
//    Playwright は認証チャレンジを実ブラウザと同じようには扱わないため（006 の
//    bfcache が Playwright で無効化されたのと同型の制約）、本ツールが記録するのは
//    「ナビゲーションが応答を返したか」「fetch が解決したか」までにとどめる。
//    ダイアログの実在は実 Chrome での手動確認へ切り出す。
//
// 🔴 Retry-After に従ったかの判定はサーバ側の到着記録で行う（measure-004.mjs と同じ規約）。

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const RESULTS = join(ROOT, "results");
const ACCESS_LOG = join(RESULTS, "004-status", "access.log");
const EDGE = "http://localhost:8088";

const ENGINES = { chromium, firefox, webkit };

/** シナリオ開始時刻より後の到着記録のうち、指定クライアントの行だけを読む */
function arrivalsSince(startMsec, clientLabel) {
  if (!existsSync(ACCESS_LOG)) return [];
  const rows = [];
  for (const line of readFileSync(ACCESS_LOG, "utf8").split("\n")) {
    const m = line.match(/^(\d+\.\d+)\s/);
    if (!m) continue;
    const t = Number(m[1]);
    if (t < startMsec) continue;
    if (!new RegExp(`cl=${clientLabel}(\\s|$)`).test(line)) continue;
    rows.push({ t, line });
  }
  return rows;
}

function emit(id, summary, raw, logLines) {
  const dir = join(RESULTS, id);
  mkdirSync(dir, { recursive: true });
  for (const [name, record] of Object.entries(raw)) {
    writeFileSync(join(dir, `browser.${name}.json`), JSON.stringify(record, null, 2) + "\n");
  }
  writeFileSync(join(dir, "browsers.json"), JSON.stringify(summary.browsers, null, 2) + "\n");
  writeFileSync(join(dir, "run.log"), logLines.join("\n") + "\n");
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`\n[${id}] results/${id}/ に summary.json / browsers.json / browser.*.json を書きました`);
}

// ------------------------------------------------- 004-browser-render

const RENDER_CODES = [200, 403, 404, 410, 429, 500, 503];

async function scenarioBrowserRender() {
  const id = "004-browser-render";
  const log = [`# ${id}`, `measured-at: ${new Date().toISOString()}`, ""];
  const raw = {};
  const browsers = {};

  for (const [name, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    browsers[name] = browser.version();
    const page = await browser.newPage();
    const per = {};

    for (const code of RENDER_CODES) {
      const res = await page.goto(`${EDGE}/004/api/codes/${code}?cs=render&cl=browser-${name}`, {
        waitUntil: "load",
      });
      const status = res?.status() ?? null;
      const bodyRendered = (await page.locator("#marker").count()) > 0
        ? (await page.locator("#marker").innerText()) === `BODY-RENDERED-${code}`
        : false;
      const scriptRan = (await page.evaluate(() => window.__marker004 ?? null)) === `SCRIPT-RAN-${code}`;
      per[code] = { status, bodyRendered, scriptRan };
      log.push(`${name}\t${code}\tstatus=${status}\tbody=${bodyRendered}\tscript=${scriptRan}`);
    }

    await browser.close();
    raw[name] = { browser: name, version: browsers[name], codes: per };
  }

  // 記事の決定表に効く形へ畳む: 全エンジンで本文が描画されたコードの本数
  const renderedEverywhere = RENDER_CODES.filter((c) =>
    Object.values(raw).every((r) => r.codes[c].bodyRendered),
  );
  const scriptEverywhere = RENDER_CODES.filter((c) => Object.values(raw).every((r) => r.codes[c].scriptRan));

  const summary = {
    browsers,
    codes_tested: RENDER_CODES,
    codes_body_rendered_all_engines: renderedEverywhere,
    codes_script_ran_all_engines: scriptEverywhere,
    engines_agree: renderedEverywhere.length === scriptEverywhere.length,
  };
  emit(id, summary, raw, log);
}

// ------------------------------------------------- 004-auth-browser

const AUTH_ARMS = [
  ["none", "/004/api/auth/none"],
  ["basic", "/004/api/auth/basic"],
  ["bearer", "/004/api/auth/bearer"],
  ["forbidden", "/004/api/auth/forbidden"],
  ["stripped_basic", "/004/stripped/auth/basic"],
];

async function scenarioAuthBrowser() {
  const id = "004-auth-browser";
  const log = [`# ${id}`, `measured-at: ${new Date().toISOString()}`, ""];
  const raw = {};
  const browsers = {};

  for (const [name, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    browsers[name] = browser.version();
    const page = await browser.newPage();
    await page.goto(`${EDGE}/004/page/`, { waitUntil: "load" });

    const per = {};
    for (const [arm, path] of AUTH_ARMS) {
      // ① fetch から見た挙動（自分のコードで処理できるか）
      const viaFetch = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u);
          return { resolved: true, status: r.status, wwwAuth: r.headers.get("www-authenticate") };
        } catch (e) {
          return { resolved: false, error: String(e) };
        }
      }, `${path}?cs=authb&cl=browser-${name}`);

      // ② ナビゲーションから見た挙動（応答が返るか）
      let nav = { returned: false, status: null };
      try {
        const res = await page.goto(`${EDGE}${path}?cs=authnav&cl=browser-${name}`, {
          waitUntil: "load",
          timeout: 5000,
        });
        nav = { returned: true, status: res?.status() ?? null };
      } catch (e) {
        nav = { returned: false, status: null, error: String(e).split("\n")[0] };
      }
      await page.goto(`${EDGE}/004/page/`, { waitUntil: "load" });

      per[arm] = { fetch: viaFetch, navigation: nav };
      log.push(
        `${name}\t${arm}\tfetch.resolved=${viaFetch.resolved} status=${viaFetch.status} wwwAuth=${JSON.stringify(viaFetch.wwwAuth)}\tnav.returned=${nav.returned} status=${nav.status}`,
      );
    }

    await browser.close();
    raw[name] = { browser: name, version: browsers[name], arms: per };
  }

  const summary = {
    browsers,
    arms_tested: AUTH_ARMS.map(([a]) => a),
    // fetch がすべてのエンジンで解決したアーム（＝自分のコードで処理できたもの）
    arms_fetch_resolved_all_engines: AUTH_ARMS.map(([a]) => a).filter((a) =>
      Object.values(raw).every((r) => r.arms[a].fetch.resolved),
    ),
    // fetch から WWW-Authenticate を読めたアーム
    arms_www_authenticate_readable: AUTH_ARMS.map(([a]) => a).filter((a) =>
      Object.values(raw).every((r) => r.arms[a].fetch.wwwAuth !== null),
    ),
    arms_navigation_returned_all_engines: AUTH_ARMS.map(([a]) => a).filter((a) =>
      Object.values(raw).every((r) => r.arms[a].navigation.returned),
    ),
    // 🔴 自動化では測れない範囲を明示する
    native_dialog_observed: "未測定（自動化ブラウザからは観測できない・実 Chrome の手動確認へ切り出す）",
  };
  emit(id, summary, raw, log);
}

// ------------------------------------------------- 004-auth-headed

// 🔴 headless と headed で結果が変わる。測定装置そのものが結果を決める例なので、
//    同じアームを両方で通し、差が出たことを記録に残す（006 の bfcache と同型）。
async function scenarioAuthHeaded() {
  const id = "004-auth-headed";
  const log = [`# ${id}`, `measured-at: ${new Date().toISOString()}`, ""];
  const raw = {};
  const browsers = {};
  const summary = {};

  for (const [name, engine] of Object.entries(ENGINES)) {
    const per = {};
    for (const headless of [true, false]) {
      const browser = await engine.launch({ headless });
      browsers[name] = browser.version();
      for (const [arm, path] of AUTH_ARMS) {
        const page = await browser.newPage();
        let r;
        try {
          const res = await page.goto(`${EDGE}${path}?cs=headed&cl=headed-${name}`, {
            waitUntil: "load",
            timeout: 4000,
          });
          r = { delivered: true, status: res?.status() ?? null };
        } catch (e) {
          // ページへ応答が渡らなかった。ブラウザが 401 を自分で処理しようとした側
          r = { delivered: false, error: String(e).split("\n")[0].replace("Error: page.goto: ", "") };
        }
        per[`${headless ? "headless" : "headed"}_${arm}`] = r;
        log.push(`${name}\theadless=${headless}\t${arm}\t${JSON.stringify(r)}`);
        await page.close();
      }
      await browser.close();
    }
    raw[name] = { browser: name, version: browsers[name], results: per };
  }

  // 「ページへ応答が渡らなかった」組み合わせだけを取り出す
  const blocked = [];
  for (const [name, rec] of Object.entries(raw)) {
    for (const [k, v] of Object.entries(rec.results)) if (!v.delivered) blocked.push(`${name}:${k}`);
  }
  summary.browsers = browsers;
  summary.arms_tested = AUTH_ARMS.map(([a]) => a);
  summary.not_delivered_to_page = blocked.sort();
  summary.headless_headed_differs = blocked.some((b) => b.includes("headed_")) && !blocked.some((b) => b.includes("headless_"));
  // 🔴 測れなかった範囲を値として持たせる（記事に断定を載せないため）
  summary.native_dialog_pixels = "未測定（実 Chrome を占有できないため。自動化はプロンプトを自前で打ち切る）";
  summary.firefox_webkit_dialog = "未測定（プロンプトを出さなかったのか、自動化が抑止したのか本装置では分けられない）";
  emit(id, summary, raw, log);
}

// ------------------------------------------------- 004-retry-browser

async function scenarioRetryBrowser() {
  const id = "004-retry-browser";
  const RA = 3;
  const log = [`# ${id}`, `measured-at: ${new Date().toISOString()}`, ""];
  const raw = {};
  const browsers = {};
  const summary = { retry_after_seconds: RA, browsers: {} };

  for (const [name, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    browsers[name] = browser.version();
    const page = await browser.newPage();
    await page.goto(`${EDGE}/004/page/`, { waitUntil: "load" });

    const cl = `browser-retry-${name}`;
    const start = Date.now() / 1000 - 1;
    const res = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return { status: r.status, retryAfter: r.headers.get("retry-after") };
    }, `/004/api/limited?cs=retryb&cl=${cl}&after=0&ra=${RA}`);

    // Retry-After の 3 倍待つ。自動で再送するクライアントなら、この間に到着が増える
    await page.waitForTimeout(RA * 3 * 1000);
    await browser.close();

    const rows = arrivalsSince(start, cl);
    raw[name] = { browser: name, version: browsers[name], first: res, arrivals: rows.map((r) => r.line) };
    summary[`arrivals_${name}`] = rows.length;
    summary[`status_${name}`] = res.status;
    summary[`retry_after_seen_${name}`] = res.retryAfter;
    log.push(`${name}\tstatus=${res.status}\tRetry-After=${res.retryAfter}\t到着 ${rows.length} 回（${RA * 3} 秒観測）`);
    for (const r of rows) log.push(`  ${r.line}`);
  }

  summary.browsers = browsers;
  summary.engines_with_auto_retry = Object.keys(ENGINES).filter((n) => summary[`arrivals_${n}`] > 1);
  emit(id, summary, raw, log);
}

// ------------------------------------------------- entry

const SCENARIOS = {
  "004-browser-render": scenarioBrowserRender,
  "004-auth-browser": scenarioAuthBrowser,
  "004-auth-headed": scenarioAuthHeaded,
  "004-retry-browser": scenarioRetryBrowser,
};

const arg = process.argv.slice(2).find((a) => a.startsWith("--scenario="));
const id = arg?.slice("--scenario=".length);
if (!id || !(id in SCENARIOS)) {
  console.error(`使い方: node tools/capture-004-browser.mjs --scenario=<${Object.keys(SCENARIOS).join("|")}>`);
  process.exit(3);
}
await SCENARIOS[id]();
