#!/usr/bin/env node
// measure-008-preflight-auth.mjs — Basic 認証をかけた領域への preflight（M2・実ブラウザ）
//
// preflight（OPTIONS）は認証情報を載せずに飛ぶ。認証を OPTIONS にもかけると
// preflight だけが 401 で落ち、本番リクエストは一度も送られない。
//
// 🔴 判定は 2 系統。
//   ① サーバ側の OPTIONS 到着記録 + そのステータス → preflight が飛んだか / 何を返したか
//   ② ブラウザ側の fetch 結果                      → 本番リクエストが通ったか
//
// 3 ケース:
//   B0 guarded  — auth_basic を location 全体にかける（OPTIONS も access フェーズに入る）
//   B1 exempt   — $authzone_realm で OPTIONS のときだけ auth_basic を off にする
//   B2 shortcut — auth_basic を書いたうえで return を content handler にした設定
//
// 使い方: node tools/measure-008-preflight-auth.mjs [--browser=chromium|firefox|webkit]
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertLogChannelLive } from "./log-channel.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "008-preflight-auth");
const LOG = join(OUT, "preflight.log");
const RUNLOG = join(OUT, "run.log");
const PAGE = "http://localhost:8080/008/";
const API = "http://localhost:8081";

// 測定専用の合成アカウント。nginx/conf.d/008-authzone.htpasswd と対になる。
// 実在のユーザーではない。サーバのログには auth=yes/no だけが残る。
//
// 🔴 値をここに書かない。htpasswd は git 管理から外してあり（資格情報を履歴に残さない）、
//    base64 で埋め込むと grep をすり抜けて同じものが履歴へ入る。環境変数から取る。
//    作り方は scenarios/008-preflight-auth/README.md を参照。
const CRED = process.env.AUTHZONE_CRED;
if (!CRED || !CRED.includes(":")) {
  console.error(
    "AUTHZONE_CRED が未設定（または 'user:pass' 形式でない）です。" +
      "scenarios/008-preflight-auth/README.md を参照してください。",
  );
  process.exit(2);
}
const BASIC = "Basic " + Buffer.from(CRED, "utf8").toString("base64");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const LAUNCHERS = { chromium, firefox, webkit };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  { id: "B0", zone: "guarded", desc: "auth_basic を location 全体にかける（OPTIONS も認証対象）" },
  { id: "B1", zone: "exempt", desc: "OPTIONS のときだけ auth_basic を off にする" },
  { id: "B2", zone: "shortcut", desc: "auth_basic + return を content handler にした設定" },
];

function logLines() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8").split("\n").filter(Boolean);
}

/** from 行目以降で prefix にマッチする OPTIONS 行を返す */
function optionsSince(from, prefix) {
  return logLines()
    .slice(from)
    .filter((l) => l.includes(" OPTIONS ") && l.includes(prefix));
}

/** ログ行から status=NNN を取り出す */
function statusOf(line) {
  const m = /status=(\d{3})/.exec(line);
  return m ? Number(m[1]) : null;
}

async function runRequest(page, url) {
  return page.evaluate(
    async ({ url, basic }) => {
      try {
        const res = await fetch(url, { method: "GET", headers: { authorization: basic } });
        return { ok: true, status: res.status };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    },
    { url, basic: BASIC }
  );
}

async function measureCase(launcher, browserName, c) {
  const browser = await launcher.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(PAGE);

  const prefix = `/008/authzone/${c.zone}/${browserName}/${c.id}`;
  const url = `${API}${prefix}/p`;
  const before = logLines().length;

  const res = await runRequest(page, url);
  await sleep(1500);

  const opts = optionsSince(before, prefix);
  const statuses = opts.map(statusOf);

  await context.close();
  await browser.close();

  return {
    case: c.id,
    zone: c.zone,
    desc: c.desc,
    browser: browserName,
    preflight_count: opts.length,
    preflight_statuses: statuses,
    fetch_ok: res.ok,
    fetch_status: res.ok ? res.status : null,
    fetch_error: res.ok ? null : res.error,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const logBefore = logLines().length;

  const header =
    [
      `measured-at: ${new Date().toISOString()}`,
      `scenario: 008-preflight-auth`,
      "mode: M2",
      `page-origin: ${PAGE}`,
      `api-origin: ${API}`,
      `judgement: サーバ側の OPTIONS 到着記録とそのステータス（生ログのみ・予測は入れない）`,
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
        `${browserName.padEnd(8)} ${r.case} ${r.zone.padEnd(9)} ` +
          `OPTIONS到着=${r.preflight_count}(status=${r.preflight_statuses.join(",") || "-"}) ` +
          `fetch=${r.fetch_ok ? `成功(${r.fetch_status})` : "失敗"}  ${r.desc}`
      );
      if (!r.fetch_ok) console.log(`         └ ${r.fetch_error}`);
    }
  }

  assertLogChannelLive(LOG, logBefore, "008-preflight-auth");

  for (const browserName of want) {
    writeFileSync(
      join(OUT, `raw.${browserName}.json`),
      JSON.stringify(rows.filter((r) => r.browser === browserName), null, 2) + "\n"
    );
  }
  console.log(`\n${rows.length} 件を results/008-preflight-auth/raw.<browser>.json に保存しました。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
