#!/usr/bin/env node
// measure-006-staleness.mjs — 「直したのに反映されない」を再現する（M2）
//
// 読者の迷いの後半はこちら側にある。max-age を効かせた結果、期限が切れるまで
// ブラウザが取りに来ないため、サーバのファイルを直しても画面が変わらない。
//
// 測り方:
//   1. 生成物 public/006/gen/app.css を rev=1 で作る（max-age=600 で配る）
//   2. 読み込んで、ブラウザが今どの版を見ているかを CSS カスタムプロパティで確認
//   3. サーバ側のファイルを rev=2 に差し替える
//   4. もう一度ページを開く → 取りに来るか / 画面はどちらの版か
//   5. URL を変える（キャッシュバスティング）→ 取りに来るか / 画面はどちらの版か
//
// 🔴 差し替えるのは git 管理外の生成物だけ。追跡ファイルを書き換えて後から戻す
//    やり方は、無関係な編集を巻き戻す事故につながるため取らない。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHARED = join(ROOT, "results", "006-cache");
const LOG = join(SHARED, "access.log");
const GEN_DIR = join(ROOT, "public", "006", "gen");
const GEN_FILE = join(GEN_DIR, "app.css");
const BASE = "https://localhost:8444";

const LAUNCHERS = { chromium, firefox, webkit };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

function logLines() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8").split("\n").filter(Boolean);
}
function hitsSince(from, cs) {
  return logLines().slice(from).filter((l) => l.includes(`cs=${cs}`) && !l.includes("/006/page"));
}
function writeRev(n) {
  mkdirSync(GEN_DIR, { recursive: true });
  writeFileSync(GEN_FILE, `:root { --rev: "${n}"; }\nbody { font-family: system-ui, sans-serif; }\n`);
}

/** ブラウザが今どの版の CSS を適用しているか */
async function revSeenBy(page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--rev").trim().replace(/"/g, "")
  );
}

async function run(browserName) {
  const launcher = LAUNCHERS[browserName];
  const cs = `stale-${browserName}`;
  const assetPath = `/006/gen/app.css?v=plain&sc=006&cs=${cs}`;
  const bustedPath = `/006/gen/app.css?v=plain&sc=006&cs=${cs}&rev=2`;
  const pageUrl = (asset, n) =>
    `${BASE}/006/page?asset=${encodeURIComponent(asset)}&cc=no-store&sc=006&cs=${cs}&n=${n}`;

  writeRev(1);
  const browser = await launcher.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const t0 = logLines().length;
  await page.goto(pageUrl(assetPath, 1));
  await sleep(700);
  const revFirst = await revSeenBy(page);
  const firstHits = hitsSince(t0, cs).length;

  // サーバ側を直す
  writeRev(2);
  await sleep(300);

  const t1 = logLines().length;
  await page.goto(pageUrl(assetPath, 2));
  await sleep(900);
  const revAfterFix = await revSeenBy(page);
  const hitsAfterFix = hitsSince(t1, cs).length;

  // URL を変える（キャッシュバスティング）
  const t2 = logLines().length;
  await page.goto(pageUrl(bustedPath, 3));
  await sleep(900);
  const revAfterBust = await revSeenBy(page);
  const hitsAfterBust = hitsSince(t2, cs).length;

  await context.close();
  await browser.close();

  return {
    scenario: "006-staleness",
    browser: browserName,
    first_load: { rev_seen: revFirst, hits: firstHits },
    after_server_fix: { rev_seen: revAfterFix, hits: hitsAfterFix },
    after_cache_busting: { rev_seen: revAfterBust, hits: hitsAfterBust },
    // サーバは直っているのにブラウザは古い版を見ているか
    stale_reproduced: revFirst === "1" && revAfterFix === "1" && hitsAfterFix === 0,
    busting_worked: revAfterBust === "2" && hitsAfterBust >= 1,
  };
}

async function main() {
  const OUT = join(ROOT, "results", "006-staleness");
  mkdirSync(OUT, { recursive: true });
  const want = args.browser ? [String(args.browser)] : ["chromium", "firefox", "webkit"];

  appendFileSync(
    join(OUT, "run.log"),
    [
      `measured-at: ${new Date().toISOString()}`,
      "scenario: 006-staleness",
      "mode: M2",
      `base: ${BASE}`,
      "judgement: サーバ側の到着記録 + ブラウザが適用している CSS の版（--rev）",
      "---",
    ].join("\n") + "\n"
  );

  const rows = [];
  for (const b of want) {
    const r = await run(b);
    if (r.first_load.hits < 1) {
      throw new Error(`[006-staleness/${b}] 1 回目が 0 件です。アセットが読み込まれていません。`);
    }
    rows.push(r);
    appendFileSync(join(OUT, "run.log"), JSON.stringify(r) + "\n");
    console.log(
      `${b.padEnd(9)} 初回=rev${r.first_load.rev_seen}(到着${r.first_load.hits}) ` +
        `サーバ修正後=rev${r.after_server_fix.rev_seen}(到着${r.after_server_fix.hits}) ` +
        `URL変更後=rev${r.after_cache_busting.rev_seen}(到着${r.after_cache_busting.hits}) ` +
        `→ 反映されない再現=${r.stale_reproduced} / バスティング有効=${r.busting_worked}`
    );
  }
  // エンジンごとに分けて書く。集計の網羅（測ったのに集計に入っていない）を
  // check-provenance がファイル名の慣習で検査できるようにするため。
  for (const r of rows) {
    writeFileSync(join(OUT, `raw.${r.browser}.json`), JSON.stringify([r], null, 2) + "\n");
  }
  console.log(`\n${rows.length} 件を results/006-staleness/raw.<browser>.json に保存しました。`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
