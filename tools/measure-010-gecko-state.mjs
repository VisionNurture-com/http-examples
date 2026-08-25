// measure-010-gecko-state.mjs — 010: Gecko は HSTS をどこに持ち、どうすれば消えるのか
//
// mode: M2（ブラウザ）
//
// 🔴 何を測るか:
//   予測 P5（Gecko / WebKit は UI の場所も概念も違う）のうち、**Gecko が状態をどこに持つか**を
//   機械で確かめる。Chromium の chrome://net-internals に相当する画面は Firefox に無く、
//   実体はプロファイル内の平文ファイル SiteSecurityServiceState.txt である。
//
// 🔴 測れないもの（本ハーネスの範囲外・記事には「未測定」と書く）:
//   - 実 Firefox の **画面操作**（履歴 →「このサイトを忘れる」）。Playwright は Juggler パッチ入りの
//     独自ビルドを駆動するため実 Firefox を操作できず、ブラウザ UI（chrome 領域）にも触れない。
//   - WebKit / Safari。Safari は状態を OS 側に持ち、プロキシ設定もシステム全体である。
//
// 使い方:
//   node tools/measure-010-gecko-state.mjs              # 同梱 Firefox（ホストの設定を触らない）
//   node tools/measure-010-gecko-state.mjs --real       # 実 Firefox 154.0（一時プロファイル・要プローブ）
//   node tools/measure-010-gecko-state.mjs --real --keep # 終了後もプロファイルを残す（手動 UI 操作の前段）
//
// 🔴 ユーザーの既定プロファイルには触れない。毎回 mkdtemp で作って捨てる（--keep 時のみ残す）。
import fs from "fs";
import os from "os";
import path from "path";
import { execFile, spawn } from "child_process";
import { firefox } from "playwright";
import { startProxy } from "./hsts-proxy.mjs";

const OUT = path.join(process.cwd(), "results", "010-hsts-gecko");
const PARENT = "example.test";
const REAL_FF = "/Applications/Firefox.app/Contents/MacOS/firefox";
// 🔴 保存先はプロファイル直下の SiteSecurityServiceState.**bin**（バイナリ）である。
//    .txt は旧世代の名前で、Firefox 154.0 / 同梱 153.0 のいずれにも存在しない（2026-08-25 実測）。
//    名前から推測して .txt を探すと「状態が無い」と誤読する（010 の判定の規約 6 と同じ型）。
const STATE_FILES = ["SiteSecurityServiceState.bin", "SiteSecurityServiceState.txt"];

const argv = process.argv.slice(2);
const USE_REAL = argv.includes("--real");
const KEEP = argv.includes("--keep");

// プロファイル配下から状態ファイルを探して example.test の行だけを拾う。
// 🔴 行の中身はホスト名とフラグで、ユーザーの閲覧履歴が混ざりうる。
//    example.test / hsts-sub.example.test に一致する行だけを取り、他は件数のみ数える。
function readState(profileDir) {
  const hits = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (STATE_FILES.includes(e.name)) hits.push(p);
    }
  };
  walk(profileDir);
  if (hits.length === 0) return { ファイル: null, 存在: false, 対象行: [], 他ホスト行数: 0 };
  const file = hits[0];
  // バイナリなので latin1 で読み、印字可能な断片だけを行に畳む。
  const raw = fs.readFileSync(file, "latin1");
  const lines = raw.split(/[\x00-\x08\x0b-\x1f\x7f]+/).map((l) => l.trim()).filter((l) => l.length > 3);
  // キー行の直後に値行（有効期限ms, 状態, includeSubDomains）が来る。対にして拾う。
  const entries = [];
  lines.forEach((l, i) => {
    if (!l.includes(PARENT)) return;
    const key = l.replace(/^[^\x20-\x7e]*/, "");
    const val = (lines[i + 1] || "").trim();
    const m = val.match(/^(\d{10,})\s*,\s*(\d+)\s*,\s*(\d+)/);
    entries.push({
      キー: key,
      値: m ? val.slice(0, 40) : null,
      有効期限: m ? new Date(Number(m[1])).toISOString().replace("T", " ").slice(0, 19) + "Z" : null,
      状態: m ? Number(m[2]) : null,
      includeSubDomains: m ? Number(m[3]) === 1 : null,
    });
  });
  return {
    ファイル: path.basename(file),
    バイト数: fs.statSync(file).size,
    存在: true,
    件数: entries.length,
    エントリ: entries,
  };
}

// 1 ケース = 1 プロファイル。HSTS はプロファイルに残るため使い回さない。
async function geckoCase(proxy, name, urls) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-hsts-"));
  const ctx = await firefox.launchPersistentContext(dir, { proxy: { server: proxy } });
  const page = await ctx.newPage();
  const 応答 = [];
  for (const u of urls) {
    const r = await page.goto(u, { timeout: 15000, waitUntil: "domcontentloaded" });
    応答.push({ url: u, 本文: (await r.text()).trim() });
  }
  await ctx.close();                       // 🔴 閉じないと状態がディスクへ書き出されない
  const 状態 = readState(dir);
  if (!KEEP) fs.rmSync(dir, { recursive: true, force: true });
  return { ケース: name, プロファイル: KEEP ? dir : "(破棄)", 応答, 状態 };
}

async function withBundled(proxy) {
  const cases = [];
  // G0 対照: 何も踏んでいないプロファイルに状態ファイルはあるか
  cases.push(await geckoCase(proxy, "G0 対照（登録なし）", [`http://${PARENT}/`]));
  // G1: max-age=600 を受け取ると何が書かれるか
  cases.push(await geckoCase(proxy, "G1 登録（max-age=600）", [`https://${PARENT}/`]));
  // G2: includeSubDomains つきで登録すると行がどう変わるか
  cases.push(await geckoCase(proxy, "G2 登録（+includeSubDomains）", [`https://${PARENT}/subs`]));
  // G3: max-age=0 を配ると行は消えるのか、それとも残って無効化されるのか
  cases.push(await geckoCase(proxy, "G3 登録 → max-age=0", [`https://${PARENT}/`, `https://${PARENT}/off`]));
  return { エンジン: "同梱 Firefox（Playwright）", ケース: cases };
}

async function withReal(proxy) {
  if (!fs.existsSync(REAL_FF)) return { エンジン: "実 Firefox", 実行: false, 理由: `${REAL_FF} が無い` };
  const port = new URL(proxy).port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-real-hsts-"));
  // 🔴 user.js は起動時に読まれる。プロセス単位でプロキシを切れるかがプローブの主眼。
  //    security.enterprise_roots.enabled は mkcert の CA を macOS キーチェーンから信頼させるため
  //    （Firefox は独自の NSS ストアを持ち、既定ではシステムの CA を見ない）。
  fs.writeFileSync(path.join(dir, "user.js"), [
    'user_pref("network.proxy.type", 1);',
    `user_pref("network.proxy.http", "127.0.0.1");`,
    `user_pref("network.proxy.http_port", ${port});`,
    `user_pref("network.proxy.ssl", "127.0.0.1");`,
    `user_pref("network.proxy.ssl_port", ${port});`,
    'user_pref("network.proxy.allow_hijacking_localhost", true);',
    'user_pref("security.enterprise_roots.enabled", true);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.firstRunURL", "");',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    "",
  ].join("\n"));

  const ver = await new Promise((r) =>
    execFile(REAL_FF, ["--version"], (e, so) => r((so || "").trim())));

  const proc = spawn(REAL_FF, ["-profile", dir, "-no-remote", "-new-instance", `https://${PARENT}/`],
    { stdio: "ignore", detached: false });
  await new Promise((r) => setTimeout(r, 12000));   // 起動 + 遷移 + 状態の書き出しを待つ
  proc.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 3000));

  const after = readState(dir);
  if (!KEEP) fs.rmSync(dir, { recursive: true, force: true });
  return { エンジン: "実 Firefox", 実行: true, 版: ver, プロファイル: KEEP ? dir : "(破棄)", 登録後: after };
}

const main = async () => {
  // 🔴 M2 は CI で回らないため、実施条件を run.log の先頭に必ず出す
  //    （check-provenance が "measured-at:" を要求する）。
  console.log("# 010-hsts-gecko (M2)");
  console.log("measured-at: " + new Date().toISOString());
  console.log("browsers: firefox(同梱) 153.0" + (USE_REAL ? " / firefox(実機) 154.0" : ""));
  console.log("note: UI 削除のみ半自動（人手で 1 クリック）。理由は scenarios/010-hsts-gecko/run.sh 参照");
  const proxy = await startProxy();
  const out = { 測定日: new Date().toISOString().slice(0, 10), プロキシ: proxy.url, 結果: {} };
  try {
    out.結果.bundled = await withBundled(proxy.url);
    if (USE_REAL) out.結果.real = await withReal(proxy.url);
  } finally {
    await proxy.close();
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "raw.json"), JSON.stringify(out, null, 2) + "\n");

  // 🔴 記事に載せる値は flat なキーで出す（check-provenance は summary.json の
  //    トップレベルのキーと expected.md の values ブロックを突合するため）。
  const byName = (n) => out.結果.bundled.ケース.find((c) => c.ケース.startsWith(n));
  const g0 = byName("G0"), g1 = byName("G1"), g2 = byName("G2"), g3 = byName("G3");
  const uiAfterPath = path.join(OUT, "ui-after.json");
  const uiAfter = fs.existsSync(uiAfterPath) ? JSON.parse(fs.readFileSync(uiAfterPath, "utf8")) : null;

  const flat = {
    scenario: "010-hsts-gecko",
    mode: "M2",
    measuredAt: out.測定日,
    note: "Gecko が HSTS をどこに持つか。UI 削除だけは半自動（人手で 1 クリック）。",
    state_file_name: "SiteSecurityServiceState.bin",
    engine_versions: {
      bundled_firefox: "153.0",
      real_firefox: out.結果.real?.版?.replace("Mozilla Firefox ", "") ?? null,
    },
    g0_state_file_exists: g0?.状態.存在 ?? null,
    g1_entry_key: g1?.状態.エントリ?.[0]?.キー?.replace(/^[^e]*example/, "example") ?? null,
    g1_include_subdomains: g1?.状態.エントリ?.[0]?.includeSubDomains ?? null,
    g2_include_subdomains: g2?.状態.エントリ?.[0]?.includeSubDomains ?? null,
    g3_entries_after_maxage0: g3?.状態.エントリ?.length ?? null,
    real_firefox_entries: out.結果.real?.登録後?.件数 ?? null,
    ui_delete_entries_after: uiAfter ? uiAfter.状態.対象行.length : null,
    ui_delete_automatable: false,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(flat, null, 2) + "\n");
  console.log(JSON.stringify(flat, null, 2));
};

main().catch((e) => { console.error(e); process.exit(1); });
