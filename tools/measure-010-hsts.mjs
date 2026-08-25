// measure-010-hsts.mjs — 010: HSTS の解除は効くのか
//
// mode: M2（ブラウザ）
//
// 🔴 判定は画面の文言ではなく「どのサーバが答えたか」で行う。
//   plain-http      = 平文 HTTP に到達した        → HSTS は効いていない
//   parent-*/child-* = HTTPS に上がった            → HSTS が効いている
//   既載の国内記事はいずれも net-internals の "Not found" 表示までで止まっており、
//   そこが本記事の差分であるため、表示を根拠にしない。
//
// 🔴 ケースごとに profile / context を作り直す。
//   HSTS はプロファイルに残るため、使い回すと前のケースが次を汚染する。
import fs from "fs";
import os from "os";
import path from "path";
import { chromium, firefox, webkit } from "playwright";
import { startProxy } from "./hsts-proxy.mjs";

const OUT = path.join(process.cwd(), "results", "010-hsts-removal");
const PARENT = "example.test";
const CHILD = "hsts-sub.example.test";

const body = async (page, url) => {
  try {
    const r = await page.goto(url, { timeout: 12000, waitUntil: "domcontentloaded" });
    return { ok: true, text: (await r.text()).trim(), finalUrl: page.url(), status: r.status() };
  } catch (e) {
    return { ok: false, text: null, finalUrl: page.url(), error: String(e.message).split("\n")[0].slice(0, 120) };
  }
};

// 到達先を 1 語に畳む。判定はこの語だけを見る。
const verdict = (r) => {
  if (!r.ok) return "error";
  if (r.text === "plain-http") return "http到達";
  if (r.text?.startsWith("parent-") || r.text === "child-quiet") return "https昇格";
  return "不明:" + r.text;
};

async function runEngine(name, launcher, proxy) {
  const cases = {};
  const fresh = async (fn) => {
    const b = await launcher.launch();
    const ctx = await b.newContext({ proxy: { server: proxy } });
    const p = await ctx.newPage();
    try { return await fn(p); } finally { await b.close(); }
  };

  // K0 対照: 何も登録していない状態で平文に届くか
  cases.K0 = await fresh(async (p) => {
    const r = await body(p, `http://${PARENT}/`);
    return { 手順: "登録なしで http へ", 到達: verdict(r), 本文: r.text, 最終URL: r.finalUrl };
  });

  // K1: dynamic 登録 → max-age=0 で解除
  cases.K1 = await fresh(async (p) => {
    const reg = await body(p, `https://${PARENT}/`);              // max-age=600
    const after = await body(p, `http://${PARENT}/`);
    const off = await body(p, `https://${PARENT}/off`);           // max-age=0
    const final = await body(p, `http://${PARENT}/`);
    return {
      手順: "STS登録 → http → max-age=0 → http",
      登録直後: verdict(after), 解除後: verdict(final),
      登録応答: reg.text, 解除応答: off.text, 最終URL: final.finalUrl,
    };
  });

  // K3: includeSubDomains は子に及ぶか / 親の解除で子も解けるか
  cases.K3 = await fresh(async (p) => {
    const childBefore = await body(p, `http://${CHILD}/`);
    await body(p, `https://${PARENT}/subs`);                      // max-age=600; includeSubDomains
    const childAfter = await body(p, `http://${CHILD}/`);
    await body(p, `https://${PARENT}/off-subs`);                  // max-age=0; includeSubDomains
    const childFinal = await body(p, `http://${CHILD}/`);
    return {
      手順: "子(前) → 親にincludeSubDomains → 子 → 親をmax-age=0 → 子",
      子_登録前: verdict(childBefore), 子_登録後: verdict(childAfter), 子_解除後: verdict(childFinal),
    };
  });

  // K6: 解除した直後に再訪すると、その場で再登録されるか（予測 P6）
  cases.K6 = await fresh(async (p) => {
    await body(p, `https://${PARENT}/`);
    await body(p, `https://${PARENT}/off`);
    const afterOff = await body(p, `http://${PARENT}/`);
    await body(p, `https://${PARENT}/`);                          // 再訪（STS が再び付く）
    const afterRevisit = await body(p, `http://${PARENT}/`);
    return {
      手順: "登録 → 解除 → http → https で再訪 → http",
      解除後: verdict(afterOff), 再訪後: verdict(afterRevisit),
    };
  });

  return { engine: name, version: null, cases };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const proxy = await startProxy();
  const log = [];
  const engines = [];

  for (const [name, l] of [["chromium(同梱)", chromium], ["firefox(同梱)", firefox], ["webkit(同梱)", webkit]]) {
    const b = await l.launch();
    const ver = b.version();
    await b.close();
    const r = await runEngine(name, l, proxy.url);
    r.version = ver;
    engines.push(r);
    log.push(`## ${name} ${ver}\n` + JSON.stringify(r.cases, null, 2));
    console.log(`[${name} ${ver}] 完了`);
  }

  await proxy.close();

  // 🔴 記事に載せる値は summary.json のトップレベルに平坦に置く。
  //   check-provenance.mjs は expected.md の values をトップレベルと突合するため、
  //   入れ子にすると記事の値が突合対象から外れる（＝裏づけなしで通る）。
  const c = (eng, k, f) => engines.find((e) => e.engine.startsWith(eng)).cases[k][f];
  const agreeOn = (k, f) => new Set(engines.map((e) => e.cases[k][f])).size === 1;

  const summary = {
    scenario: "010-hsts-removal",
    mode: "M2",
    measuredAt: new Date().toISOString(),
    note: "判定は到達したサーバの本文で行う。plain-http = 平文到達 / parent-*・child-quiet = https 昇格",
    browsers: engines.map((e) => e.engine.replace(/\(.*/, "")),
    engine_versions: Object.fromEntries(engines.map((e) => [e.engine.replace(/\(.*/, ""), e.version])),
    cases_total: Object.keys(engines[0].cases).length,
    engines_agree: ["K0:到達", "K1:登録直後", "K1:解除後", "K3:子_登録前", "K3:子_登録後",
                    "K3:子_解除後", "K6:解除後", "K6:再訪後"].every((s) => agreeOn(...s.split(":"))),
    k0_no_registration: c("chromium", "K0", "到達"),
    k1_after_register: c("chromium", "K1", "登録直後"),
    k1_after_maxage0: c("chromium", "K1", "解除後"),
    k3_child_before: c("chromium", "K3", "子_登録前"),
    k3_child_after_subs: c("chromium", "K3", "子_登録後"),
    k3_child_after_off: c("chromium", "K3", "子_解除後"),
    k6_after_off: c("chromium", "K6", "解除後"),
    k6_after_revisit: c("chromium", "K6", "再訪後"),
    engines,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  const head = [
    "# 010-hsts-removal (M2)",
    `measured-at: ${summary.measuredAt}`,
    `browsers: ${engines.map((e) => e.engine + " " + e.version).join(" / ")}`,
    "",
    "🔴 Playwright 同梱版。実 Firefox 154.0 に対し同梱は 153.0 でメジャー 1 つ古い。",
    "🔴 判定は到達したサーバの本文。plain-http = 平文到達 / parent-*・child-quiet = https 昇格。",
    "🔴 ブラウザには tools/hsts-proxy.mjs が :80 / :443 に見せている（RFC 6797 §8.3 対策）。",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "run.log"), head + log.join("\n\n") + "\n");
  console.log("→ results/010-hsts-removal/summary.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
