// measure-010-ui.mjs — 010: ブラウザ UI からの HSTS 削除は効くのか（実 Chrome）
//
// mode: M2（実ブラウザ）
//
// 🔴 Playwright 同梱の Chromium では chrome://net-internals に到達できない
//   （page.goto も CDP の Page.navigate も net::ERR_INVALID_URL）。実 Chrome が要る。
// 🔴 ユーザーの既定プロファイルは触らない。mkdtemp の一時プロファイルを使い、
//   終了時に削除する。HSTS はプロファイルに残るため、空から始めるのが正しい。
// 🔴 判定は Query の出力フィールドで行う。static_* は preload 由来、dynamic_* は
//   ヘッダ由来で、別フィールドとして返る。画面の "Not found" 表示を根拠にしない。
import fs from "fs";
import os from "os";
import path from "path";
import { chromium } from "playwright";
import { startProxy } from "./hsts-proxy.mjs";

const OUT = path.join(process.cwd(), "results", "010-hsts-ui");
const NI = "chrome://net-internals/#hsts";
const PARENT = "example.test";
const PRELOADED = "github.com"; // 所有していないが、状態は Query できる

const field = (t, k) => (t.match(new RegExp(`^${k}:\\s*(.*)$`, "m")) || [, ""])[1].trim();

async function query(page, host) {
  await page.goto(NI, { timeout: 10000 });
  await page.fill("#hsts-view-query-input", host);
  await page.click("#hsts-view-query-submit");
  await page.waitForTimeout(700);
  const t = await page.locator("#hsts-view-query-output").innerText();
  return {
    raw: t.slice(0, 500),
    found: /^Found:/m.test(t),
    static_sts_domain: field(t, "static_sts_domain"),
    static_upgrade_mode: field(t, "static_upgrade_mode"),
    dynamic_sts_domain: field(t, "dynamic_sts_domain"),
    dynamic_upgrade_mode: field(t, "dynamic_upgrade_mode"),
  };
}

async function del(page, host) {
  await page.goto(NI, { timeout: 10000 });
  await page.fill("#domain-security-policy-view-delete-input", host);
  await page.click("#domain-security-policy-view-delete-submit");
  await page.waitForTimeout(700);
}

async function reach(page, url) {
  try {
    const r = await page.goto(url, { timeout: 12000, waitUntil: "domcontentloaded" });
    const text = (await r.text()).trim();
    return text === "plain-http" ? "http到達" : text.startsWith("parent-") ? "https昇格" : "不明:" + text;
  } catch (e) {
    return "error:" + String(e.message).split("\n")[0].slice(0, 80);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const proxy = await startProxy();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hsts-ui-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chrome", headless: false,
    args: ["--no-first-run", "--no-default-browser-check"],
    proxy: { server: proxy.url },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const version = await page.evaluate(() => navigator.userAgentData?.brands?.map(b => b.brand + " " + b.version).join(", ") ?? navigator.userAgent);

  // K2: dynamic（ヘッダ由来）を UI で削除する
  await page.goto(`https://${PARENT}/`, { timeout: 12000 });        // max-age=600 を受け取る
  const k2_before = await query(page, PARENT);
  const k2_httpBefore = await reach(page, `http://${PARENT}/`);
  await del(page, PARENT);
  const k2_after = await query(page, PARENT);
  const k2_httpAfter = await reach(page, `http://${PARENT}/`);

  // K5: static（preload 由来）を UI で削除しようとする
  const k5_before = await query(page, PRELOADED);
  await del(page, PRELOADED);
  const k5_after = await query(page, PRELOADED);

  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  await proxy.close();

  const summary = {
    scenario: "010-hsts-ui",
    mode: "M2",
    browser: "実 Chrome（channel:chrome・一時プロファイル）",
    uaBrands: version,
    measuredAt: new Date().toISOString(),
    selectors: {
      query: "#hsts-view-query-input + #hsts-view-query-submit",
      delete: "#domain-security-policy-view-delete-input + #domain-security-policy-view-delete-submit",
      output: "#hsts-view-query-output",
    },
    // 🔴 記事に載せる値は平坦に置く（check-provenance はトップレベルを見る）
    chrome_version_ua: version,
    k2_dynamic_before: k2_before.dynamic_sts_domain,
    k2_dynamic_after: k2_after.dynamic_sts_domain,
    k2_http_before: k2_httpBefore,
    k2_http_after: k2_httpAfter,
    k2_ui_delete_effective: k2_before.dynamic_sts_domain === PARENT && k2_after.dynamic_sts_domain === "",
    k5_static_before: k5_before.static_sts_domain,
    k5_static_after: k5_after.static_sts_domain,
    k5_mode_before: k5_before.static_upgrade_mode,
    k5_mode_after: k5_after.static_upgrade_mode,
    k5_ui_delete_effective: k5_before.static_sts_domain !== k5_after.static_sts_domain,
    cases: {
      K2: { 対象: PARENT, 由来: "dynamic（ヘッダ）",
            削除前: { dynamic_sts_domain: k2_before.dynamic_sts_domain, dynamic_upgrade_mode: k2_before.dynamic_upgrade_mode, http到達: k2_httpBefore },
            削除後: { dynamic_sts_domain: k2_after.dynamic_sts_domain, dynamic_upgrade_mode: k2_after.dynamic_upgrade_mode, http到達: k2_httpAfter } },
      K5: { 対象: PRELOADED, 由来: "static（preload）",
            削除前: { found: k5_before.found, static_sts_domain: k5_before.static_sts_domain, static_upgrade_mode: k5_before.static_upgrade_mode },
            削除後: { found: k5_after.found, static_sts_domain: k5_after.static_sts_domain, static_upgrade_mode: k5_after.static_upgrade_mode } },
    },
    raw: { k2_before: k2_before.raw, k2_after: k2_after.raw, k5_before: k5_before.raw, k5_after: k5_after.raw },
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(
    path.join(OUT, "run.log"),
    [
      "# 010-hsts-ui (M2)",
      `measured-at: ${summary.measuredAt}`,
      `browser: 実 Chrome（channel:chrome・一時プロファイル） ${version}`,
      "",
      "🔴 判定は Query の出力フィールド（static_* / dynamic_*）。画面の Not found 表示ではない。",
      "🔴 github.com は所有していない。状態を読んだだけで通信はしていない。",
      "",
      "## K2 dynamic（ヘッダ由来）の削除",
      "### 削除前", k2_before.raw, "### 削除後", k2_after.raw,
      `http 到達: 削除前=${k2_httpBefore} / 削除後=${k2_httpAfter}`,
      "",
      "## K5 static（preload 由来）の削除",
      "### 削除前", k5_before.raw, "### 削除後", k5_after.raw,
      "",
    ].join("\n") + "\n",
  );
  console.log(JSON.stringify(summary.cases, null, 2));
  console.log("→ results/010-hsts-ui/summary.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
