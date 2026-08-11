#!/usr/bin/env node
// measure-006-hard-reload.mjs — 通常リロードとハードリロードの差を測る（M2・GUI 操作）
//
// なぜ GUI が要るか: ハードリロード（Cmd+Shift+R）に対応する自動化 API がない。
// Playwright の page.reload() は通常リロード相当で、キーボード送出は headless では
// ブラウザ本体に届かない（実測済み）。そこで headed で起動し、OS 経由でキーを送る。
//
// 🔴 キーが届かなかったときに「再取得しなかった」と読まないための事前条件を置く。
//    判定ページは no-store なので、リロードが起きていれば必ずページ自身が再要求される。
//    ページの再要求が 0 件なら、それはブラウザが何も受け取っていないということ。
//
// 前提: macOS のアクセシビリティ許可（/usr/bin/osascript）が要る。
//       許可がないとキーが届かず、本スクリプトは測定不成立として落ちる。
//
// 使い方: node tools/measure-006-hard-reload.mjs [--browser=firefox|chromium]

import { chromium, firefox } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const SHARED = join(ROOT, "results", "006-cache");
const LOG = join(SHARED, "access.log");
const OUT = join(ROOT, "results", "006-hard-reload");
const BASE = "https://localhost:8444";

const LAUNCHERS = { chromium, firefox };
// Playwright が起動する実体のプロセス名。環境で揺れるため候補で持つ。
const PROC_CANDIDATES = {
  firefox: ["firefox", "Nightly"],
  chromium: ["Chromium", "Google Chrome for Testing", "Chrome"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const lines = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean) : []);
const since = (from, cs, kind) =>
  lines()
    .slice(from)
    .filter((l) => l.includes(`cs=${cs}`) && (kind === "page" ? l.includes("/006/page") : !l.includes("/006/page")));
const statusOf = (l) => Number((l.match(/status=(\d{3})/) || [])[1] ?? 0);

/** 実際に前面化できたプロセス名を返す。できなければ null。 */
function focus(engine) {
  for (const name of PROC_CANDIDATES[engine]) {
    try {
      execSync(
        `osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "${name}") to true'`,
        { stdio: "pipe" }
      );
      return name;
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

function sendKey(hard) {
  const mods = hard ? "command down, shift down" : "command down";
  execSync(`osascript -e 'delay 0.8' -e 'tell application "System Events" to keystroke "r" using {${mods}}'`, {
    stdio: "pipe",
  });
}

async function one(engine, variant, hard) {
  const kind = hard ? "hard" : "normal";
  const cs = `hr-${engine}-${variant}-${kind}`;
  const assetPath = `/006/asset/app.css?v=${variant}&sc=006&cs=${cs}`;
  const url = `${BASE}/006/page?asset=${encodeURIComponent(assetPath)}&cc=no-store&sc=006&cs=${cs}&n=1`;

  const browser = await LAUNCHERS[engine].launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(url);
  await sleep(1500);

  const mid = lines().length;
  const proc = focus(engine);
  if (proc) sendKey(hard);
  await sleep(3000);

  const doc = since(mid, cs, "page");
  const asset = since(mid, cs, "asset");
  await context.close();
  await browser.close();

  // 🔴 ページが再要求されていない = キーが届いていない。
  //    これを「再取得しなかった」と読むと、届かなかった事実が測定値に化ける。
  if (doc.length === 0) {
    throw new Error(
      `[006-hard-reload/${engine}/${variant}/${kind}] ページ自身が再要求されていません（前面化: ${proc ?? "失敗"}）。\n` +
        "キーストロークがブラウザに届いていないため、この実行は測定として成立していません。\n" +
        "macOS のシステム設定 > プライバシーとセキュリティ > アクセシビリティ で /usr/bin/osascript を許可してください。"
    );
  }

  return {
    scenario: "006-hard-reload",
    browser: engine,
    variant,
    reload_kind: kind,
    focused_process: proc,
    page_rerequested: doc.length,
    asset_hits: asset.length,
    asset_statuses: asset.map(statusOf),
    silent: asset.length === 0,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const engines = args.browser ? [String(args.browser)] : ["firefox", "chromium"];

  appendFileSync(
    join(OUT, "run.log"),
    [
      `measured-at: ${new Date().toISOString()}`,
      "scenario: 006-hard-reload",
      "mode: M2",
      `base: ${BASE}`,
      "judgement: サーバ側の到着記録。ページ自身の再要求をキー到達の事前条件とする",
      "---",
    ].join("\n") + "\n"
  );

  const rows = [];
  for (const engine of engines) {
    for (const variant of ["plain", "immutable"]) {
      for (const hard of [false, true]) {
        const r = await one(engine, variant, hard);
        rows.push(r);
        appendFileSync(join(OUT, "run.log"), JSON.stringify(r) + "\n");
        console.log(
          `${engine.padEnd(9)} ${variant.padEnd(10)} ${r.reload_kind.padEnd(6)} ` +
            `ページ再要求=${r.page_rerequested} アセット=${r.asset_hits} ${JSON.stringify(r.asset_statuses)} ` +
            `→ ${r.silent ? "訊きにも来ない" : "来た"}`
        );
      }
    }
  }

  for (const e of engines) {
    writeFileSync(join(OUT, `raw.${e}.json`), JSON.stringify(rows.filter((r) => r.browser === e), null, 2) + "\n");
  }
  console.log(`\n${rows.length} 件を results/006-hard-reload/raw.<browser>.json に保存しました。`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
