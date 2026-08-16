#!/usr/bin/env node
// measure-003-browser.mjs — 記事 003 の M2 シナリオを測る（実ブラウザ 3 エンジン・CI では回らない）
//
// 測るもの:
//   003-method-override   … form が実際にワイヤへ送るメソッド（_method 偽装 / method="PUT"）
//   003-redirect-browser  … 301〜308 をブラウザの fetch が追ったときのメソッドとボディ
//   003-prefetch          … 状態を変える GET を先読みが踏むか
//
// 🔴 判定は 2 系統で取る。
//    ① アプリ側の到着記録（GET /003/state）
//    ② nginx の到着記録（results/003-methods/access.log の $request_method）
//    片方だけでは「届いたが別の理由で失敗した」と「そもそも届いていない」を分けられない。
//
// 🔴 エンジンごとに POST /003/__reset を挟む。ページに識別子を後から差し込むと、
//    踏まれなかったときに「エンジンが踏まない」のか「差し込みが効かない」のか分けられない。
//
// 使い方: node tools/measure-003-browser.mjs --scenario=003-method-override

import { writeFileSync, mkdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = "http://localhost:8085";
const ACCESS_LOG = join(ROOT, "results", "003-methods", "access.log");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const ENGINES = { chromium, firefox, webkit };

function curlJson(path) {
  const out = execFileSync("curl", ["-sS", `${BASE}${path}`], { encoding: "utf8", maxBuffer: 8e6 });
  return JSON.parse(out);
}

function reset() {
  execFileSync("curl", ["-sS", "-o", "/dev/null", "-X", "POST", `${BASE}/003/__reset`]);
}

/** nginx の到着記録を「このエンジンの区間」だけ切り出す */
function logTail(fromByte) {
  if (!existsSync(ACCESS_LOG)) return [];
  const buf = readFileSync(ACCESS_LOG, "utf8");
  return buf.slice(fromByte).split("\n").filter(Boolean);
}
function logSize() {
  return existsSync(ACCESS_LOG) ? statSync(ACCESS_LOG).size : 0;
}

/**
 * access.log の 1 行から「ワイヤに出たメソッド」と cs を読む。
 *
 * 🔴 cs= は uri="..." の中にも現れる。最初の cs= を拾うと URI 側にぶつかり、
 *    閉じ引用符まで巻き込んだ値になる（実際に 1 回目の測定で起きた）。
 *    ログのフィールドは空白区切りなので、直前が空白のものだけを拾う。
 */
function parseLogLine(line) {
  const method = (line.match(/^\S+\s+(\S+)\s/) || [])[1] ?? null;
  const cs = (line.match(/\scs=(\S+)/) || [])[1] ?? null;
  const uri = (line.match(/uri="([^"]*)"/) || [])[1] ?? null;
  return { method, cs, uri };
}

// ---------------------------------------------------------------- シナリオ

const SCENARIOS = {
  // form が実際に送るメソッド。ワイヤに出たものを 2 系統で読む
  "003-method-override": async (page, log) => {
    const cases = [
      ["form_post_override", "#f-post-override"],
      ["form_put_attr", "#f-put-attr"],
      ["form_post_plain", "#f-post-plain"],
      ["form_get_plain", "#f-get-plain"],
    ];
    for (const [name, sel] of cases) {
      await page.goto(`${BASE}/003/page/override.html`, { waitUntil: "load" });
      await page.click(`${sel} button`);
      // 🔴 waitForLoadState では待てない。ページはすでに load 済みなので即座に解決し、
      //    次の goto が飛行中の送信を打ち切る。実際に WebKit だけ 1 件が届かず、
      //    「WebKit は POST form を送らない」という誤った結論が出かけた。
      //    遷移が起きたこと（URL が変わったこと）を待つ。
      await page.waitForURL((u) => !u.pathname.endsWith("override.html"), { timeout: 15000 });
      log.push(`  submit ${name} → ${page.url()}`);
    }
    // 対照。fetch で本物の PUT を出す
    await page.goto(`${BASE}/003/page/blank.html`, { waitUntil: "load" });
    await page.evaluate(async () => {
      await fetch("/003/override/target?cs=fetch_put", { method: "PUT" });
    });

    const st = curlJson("/003/state");
    const seen = {};
    const wire = {};
    for (const o of st.overrides) {
      if (!o.cs) continue;
      seen[o.cs] = o.handler;
      wire[o.cs] = o.original_method;
    }
    return { handler_reached: seen, wire_method_seen_by_app: wire, overrides_recorded: st.overrides.length };
  },

  // ブラウザの fetch がリダイレクトを追ったときのメソッドとボディ
  "003-redirect-browser": async (page, log) => {
    const codes = [301, 302, 303, 307, 308];
    await page.goto(`${BASE}/003/page/blank.html`, { waitUntil: "load" });
    for (const code of codes) {
      await page.evaluate(async (c) => {
        await fetch(`/003/redirect/${c}?cs=fetch${c}`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "amount=1000",
        });
      }, code);
      log.push(`  fetch POST → /003/redirect/${code}`);
    }
    const st = curlJson("/003/state");
    const method = {};
    const bodyBytes = {};
    for (const a of st.arrivals) {
      method[a.code] = a.method;
      bodyBytes[a.code] = a.body_length;
    }
    return { method_at_destination: method, body_bytes_at_destination: bodyBytes, arrivals_recorded: st.arrivals.length };
  },

  // 先読みが、状態を変える GET を踏むか
  "003-prefetch": async (page, log) => {
    await page.goto(`${BASE}/003/page/prefetch.html`, { waitUntil: "load" });
    // 先読みは投機的に走る。載るまで待つ（踏まなければ 0 のまま）
    await page.waitForTimeout(5000);
    const st = curlJson("/003/state");
    const consumed = st.quota.prefetch ?? 0;
    log.push(`  quota.prefetch=${consumed}`);
    return { prefetch_fired: consumed > 0, consumed_by_prefetch: consumed };
  },
};

// ---------------------------------------------------------------- 実行

const id = args.scenario;
if (!id || !SCENARIOS[id]) {
  console.error(`✗ USAGE [measure-003-browser] --scenario=<${Object.keys(SCENARIOS).join(" | ")}>`);
  process.exit(3);
}

const dir = join(ROOT, "results", id);
mkdirSync(dir, { recursive: true });

const log = [];
const perEngine = {};
const versions = {};
const wireFromNginx = {};

for (const [name, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  versions[name] = browser.version();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  reset();
  const from = logSize();

  log.push(`## ${name} ${versions[name]}`);
  const values = await SCENARIOS[id](page, log);
  perEngine[name] = values;

  // nginx 側の到着記録（第 2 系統）
  const lines = logTail(from).map(parseLogLine).filter((l) => l.cs && l.cs !== "-");
  wireFromNginx[name] = Object.fromEntries(lines.map((l) => [l.cs, l.method]));
  log.push(`  nginx が受けたメソッド: ${JSON.stringify(wireFromNginx[name])}`);
  log.push("");

  writeFileSync(join(dir, `raw.${name}.json`), JSON.stringify({ engine: name, version: versions[name], values, nginx: wireFromNginx[name] }, null, 2) + "\n");

  await context.close();
  await browser.close();
}

// エンジン横断の集計。キーごとにエンジン → 値の形へ畳む
const keys = [...new Set(Object.values(perEngine).flatMap((v) => Object.keys(v)))];
const summary = { browsers: versions, wire_method_seen_by_nginx: wireFromNginx };
for (const k of keys) {
  summary[k] = Object.fromEntries(Object.entries(perEngine).map(([e, v]) => [e, v[k]]));
}

const header = [
  `measured-at: ${new Date().toISOString()}`,
  `scenario: ${id}`,
  `mode: M2`,
  `base: ${BASE}`,
  `engines: ${Object.entries(versions).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
  "---",
  "",
];

writeFileSync(join(dir, "run.log"), header.concat(log).join("\n") + "\n");
writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`[measure-003-browser] ${id} — 3 エンジンを記録しました`);
