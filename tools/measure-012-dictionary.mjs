#!/usr/bin/env node
// measure-012-dictionary.mjs — 圧縮辞書（RFC 9842）が素の nginx で成立するかを実ブラウザで測る（M2）
//
// 測るもの:
//   ① ブラウザは Use-As-Dictionary の付いた応答を辞書として登録するか
//   ② 次の版を取りにいくとき Available-Dictionary と Accept-Encoding: dcb/dcz を送るか
//   ③ サーバが返した差分をブラウザが復号できるか（decodedBodySize が元の大きさに戻るか）
//
// 🔴 判定は 2 系統で取る。
//    ① ブラウザ側の観測（要求ヘッダ / Resource Timing）
//    ② nginx の到着記録（results/012-dictionary/access.log の dict_matched）
//    片方だけでは「辞書を送ったが一致しなかった」と「そもそも送っていない」を分けられない。
//
// 🔴 証明書が信頼されていないと secure context にならず、辞書機構そのものが動かない。
//    そのため ignoreHTTPSErrors では測らない。mkcert の CA を使い、
//    --host-resolver-rules で *.example.test を 127.0.0.1 へ向ける。
//
// 前提: bash tools/gen-certs.sh && docker compose up -d --wait
//       node tools/make-012-artifacts.mjs
// 使い方: node tools/measure-012-dictionary.mjs [--engine=chrome|chromium|firefox|webkit]
// 出力  : results/012-dictionary/browser-<engine>.json

import { writeFileSync, appendFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "results", "012-dictionary");
const ACCESS_LOG = join(OUT_DIR, "access.log");

// 012 専用の入口。既定は localhost（名前解決の細工が要らず、mkcert の証明書がそのまま効く）。
// 🔴 localhost は「証明書がどうであれ信頼できる出自」として特別扱いされる。
//    手元の CA を本番同様のホスト名で使ったときの挙動は --host / --port で測る。
const HOST = process.env.DICT_HOST ?? "localhost";
const PORT = Number(process.env.DICT_PORT ?? 8445);
const BASE = `https://${HOST}:${PORT}`;
const DICT_URL = "/012/bundle-v1.js";

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

// 🔴 dcb と dcz のどちらを返すかはサーバが決める。既定の入口は dcb を先に選ぶため、
//    dcz 側の配信・復号は専用の入口（--dcz）で確かめる。
const TARGET = args.dcz ? "/012/bundle-v2-dcz.js" : "/012/bundle-v2.js";
const PAGE2 = args.dcz ? "/012/v2dcz.html" : "/012/v2.html";

const engineName = args.engine ?? "chrome";
const engine = ENGINES[engineName];
if (!engine) {
  console.error(`不明なエンジン: ${engineName}（${Object.keys(ENGINES).join(" / ")}）`);
  process.exit(2);
}

/** エンジンごとの起動オプション。localhost で開けるため名前解決の細工は要らない */
function launchOptions(name, base) {
  if (name !== "chrome" && name !== "chromium") {
    // firefox / webkit は Chromium のフラグを解さない。既定のまま測り、
    // 「そもそも dcb / dcz を送るエンジンなのか」を見る
    return { ...base };
  }
  const extra = [];
  // 既定で有効かどうかを切り分けるため、明示的に有効化したときの挙動も測れるようにする
  if (args.features) extra.push(`--enable-features=${args.features}`);
  // localhost 以外の名前で測るとき、その名前を 127.0.0.1 へ寄せる（証明書は差し替えない）
  if (HOST !== "localhost") extra.push(`--host-resolver-rules=MAP ${HOST} 127.0.0.1`);

  // 🔴 Chrome は「公的に信頼されたルートから辿れる証明書」でないと辞書を使わない
  //    （CompressionDictionaryTransportRequireKnownRootCert）。手元の CA では
  //    登録までは成功し、使用だけが黙って飛ばされる。DevTools にも何も出ない。
  //    既定ではこのゲートを外して測り、外さない場合との差は --require-known-root で取る。
  if (!args["require-known-root"]) {
    extra.push("--disable-features=CompressionDictionaryTransportRequireKnownRootCert");
  }
  return { ...base, args: [...(base.args ?? []), ...extra] };
}

const accessLogBefore = existsSync(ACCESS_LOG) ? readFileSync(ACCESS_LOG, "utf8").split("\n").length : 0;

// 🔴 辞書ストレージはシークレット相当のコンテキストでは働かない。
//    launch() + newContext() は毎回まっさらな一時プロファイル（＝off-the-record 扱い）に
//    なるため、通常のプロファイルを明示して測る。
// 🔴 プロファイルは results/ の外へ置く。ブラウザが自分の絶対パスをログへ書くため、
//    リポジトリ内に置くと check-neutrality が落ちる（公開移管を壊す混入そのもの）。
const profileDir = join(tmpdir(), `http-examples-012-${engineName}`);
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });
const context = await engine.launcher.launchPersistentContext(
  profileDir,
  launchOptions(engineName, engine.opts)
);
const browser = context.browser();
const version = browser ? browser.version() : "(persistent context)";
const page = context.pages()[0] ?? (await context.newPage());

const observed = [];
page.on("request", async (req) => {
  if (!req.url().includes("bundle-v")) return;
  observed.push({ phase: "request", url: req.url(), headers: await req.allHeaders() });
});
page.on("response", async (res) => {
  if (!res.url().includes("bundle-v")) return;
  observed.push({ phase: "response", url: res.url(), status: res.status(), headers: await res.allHeaders() });
});

// --- 手順 1: 辞書を配る ---
await page.goto(`${BASE}/012/index.html`, { waitUntil: "load" });
// 登録はブラウザ内部の非同期処理。取りこぼしを避けるため少し待つ
await page.waitForTimeout(1500);

// --- 手順 2: 次の版を取りにいく ---
await page.goto(`${BASE}${PAGE2}`, { waitUntil: "load" });
await page.waitForTimeout(500);

const timing = await page.evaluate((target) => {
  const r = performance.getEntriesByType("resource").find((e) => e.name.endsWith(target));
  if (!r) return null;
  return {
    name: r.name,
    transferSize: r.transferSize,
    encodedBodySize: r.encodedBodySize,
    decodedBodySize: r.decodedBodySize,
  };
}, TARGET);

await context.close();

// --- nginx 側の到着記録（この実行ぶんだけ切り出す）---
const accessLines = existsSync(ACCESS_LOG)
  ? readFileSync(ACCESS_LOG, "utf8").split("\n").filter(Boolean).slice(Math.max(0, accessLogBefore - 1))
  : [];

const v2Request = observed.find((o) => o.phase === "request" && o.url.endsWith(TARGET));
const v2Response = observed.find((o) => o.phase === "response" && o.url.endsWith(TARGET));
const dictResponse = observed.find((o) => o.phase === "response" && o.url.endsWith(DICT_URL));

const verdict = {
  辞書の応答にUseAsDictionaryが付いたか: Boolean(dictResponse?.headers["use-as-dictionary"]),
  次の版の要求にAvailableDictionaryが付いたか: Boolean(v2Request?.headers["available-dictionary"]),
  要求のAcceptEncodingにdcbまたはdczがあるか: /\bdc[bz]\b/.test(v2Request?.headers["accept-encoding"] ?? ""),
  応答のContentEncoding: v2Response?.headers["content-encoding"] ?? "(なし)",
  nginxが返したファイル: v2Response?.headers["x-served-file"] ?? "(なし)",
  復号後の大きさが元に戻ったか: timing ? timing.decodedBodySize > timing.encodedBodySize : null,
};

const payload = {
  measuredAt: new Date().toISOString(),
  engine: engineName,
  version,
  requireKnownRootCert: Boolean(args["require-known-root"]),
  base: BASE,
  verdict,
  timing,
  observed,
  nginxAccessLog: accessLines,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, `browser-${args.label ?? engineName}.json`), JSON.stringify(payload, null, 2) + "\n");

// 生ログへ 1 行足す（先頭のヘッダは make-012-artifacts.mjs が書く）
appendFileSync(
  join(OUT_DIR, "run.log"),
  JSON.stringify({
    step: "browser",
    label: args.label ?? engineName,
    engine: engineName,
    version,
    base: BASE,
    requireKnownRootCert: payload.requireKnownRootCert,
    verdict,
    timing,
  }) + "\n"
);

console.log(`=== ${engineName} (version=${version}) ===`);
for (const [k, v] of Object.entries(verdict)) console.log(`  ${k}: ${v}`);
if (timing) {
  console.log(
    `  Resource Timing: transferSize=${timing.transferSize} encodedBodySize=${timing.encodedBodySize} decodedBodySize=${timing.decodedBodySize}`
  );
}
console.log("\n--- nginx の到着記録 ---");
for (const l of accessLines) console.log("  " + l);
console.log(`\n生ログ: results/012-dictionary/browser-${args.label ?? engineName}.json`);
