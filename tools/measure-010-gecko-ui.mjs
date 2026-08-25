// measure-010-gecko-ui.mjs — 010: Gecko の UI 削除が HSTS の行を消すか（半自動）
//
// mode: M2（ブラウザ・**手動操作を 1 回挟む**）
//
// 🔴 なぜ半自動か（2026-08-25 実測）:
//   Firefox の chrome UI（ライブラリ画面・メニュー）は Gecko が描いており、
//   macOS のアクセシビリティ API にはほぼ露出しない。実測では本体ウィンドウもライブラリ画面も
//   AXButton 3 個しか返さず、行の列挙も右クリックもできなかった。
//   Playwright は Juggler パッチ入りビルドを駆動するため実 Firefox を操作できない。
//   したがって「このサイトを忘れる」のクリックだけは人手で行う。
//
// 🔴 ユーザーの既定 Firefox には触れない:
//   -profile / -no-remote / -new-instance で別プロセス・別プロファイルとして起動する。
//   プロファイルが分かれているため、この画面での操作がユーザーのデータへ及ぶことはない。
//
// 使い方:
//   node tools/measure-010-gecko-ui.mjs --setup    # 登録して Firefox を開いたまま終了（手動操作の前）
//   node tools/measure-010-gecko-ui.mjs --read <profileDir>   # 手動操作の後に状態を読む
import fs from "fs"; import os from "os"; import path from "path";
import { execFile, spawn } from "child_process";
import { startProxy } from "./hsts-proxy.mjs";

const P = "example.test";
const FF = "/Applications/Firefox.app/Contents/MacOS/firefox";
const STATE = "SiteSecurityServiceState.bin";
const MARK = path.join(process.cwd(), "results", "010-hsts-gecko", "ui-profile.txt");

function readState(dir) {
  const f = path.join(dir, STATE);
  if (!fs.existsSync(f)) return { 存在: false, 対象行: [], バイト数: 0 };
  const raw = fs.readFileSync(f, "latin1");
  const lines = raw.split(/[\x00-\x08\x0b-\x1f\x7f]+/).map((l) => l.trim()).filter((l) => l.length > 3);
  const out = [];
  lines.forEach((l, i) => {
    if (!l.includes(P)) return;
    const v = (lines[i + 1] || "").trim();
    const m = v.match(/^(\d{10,})\s*,\s*(\d+)\s*,\s*(\d+)/);
    out.push({ キー: l.replace(/^[^\x20-\x7e]*/, ""), 値: m ? v.slice(0, 32) : null,
      有効期限: m ? new Date(Number(m[1])).toISOString().replace("T", " ").slice(0, 19) + "Z" : null,
      includeSubDomains: m ? Number(m[3]) === 1 : null });
  });
  return { 存在: true, バイト数: fs.statSync(f).size, 対象行: out };
}

if (process.argv.includes("--read")) {
  const dir = process.argv[process.argv.indexOf("--read") + 1] || (fs.existsSync(MARK) ? fs.readFileSync(MARK, "utf8").trim() : null);
  if (!dir) { console.error("プロファイルのパスが分かりません"); process.exit(1); }
  console.log(JSON.stringify({ プロファイル: dir, 状態: readState(dir) }, null, 2));
  process.exit(0);
}

const proxy = await startProxy();
const port = new URL(proxy.url).port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-ui-manual-"));
fs.writeFileSync(path.join(dir, "user.js"), [
  'user_pref("network.proxy.type", 1);',
  `user_pref("network.proxy.http","127.0.0.1"); user_pref("network.proxy.http_port",${port});`,
  `user_pref("network.proxy.ssl","127.0.0.1"); user_pref("network.proxy.ssl_port",${port});`,
  'user_pref("security.enterprise_roots.enabled", true);',
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("browser.aboutwelcome.enabled", false);', ""].join("\n"));

// 🔴 detached + unref。付けないと node のイベントループが子に縛られ、
//    スクリプトが終了せず（タイムアウトで殺されると Firefox ごと落ちる）。
const child = spawn(FF, ["-profile", dir, "-no-remote", "-new-instance", `https://${P}/`],
  { stdio: "ignore", detached: true });
child.unref();
await new Promise((r) => setTimeout(r, 14000));
const pid = await new Promise((r) => execFile("/bin/sh", ["-c",
  `ps -Ao pid,command | grep '[F]irefox.app/Contents/MacOS/firefox' | grep -F -- '${dir}' | awk '{print $1}' | head -1`],
  (e, so) => r((so || "").trim())));
const before = readState(dir);
fs.mkdirSync(path.dirname(MARK), { recursive: true });
fs.writeFileSync(MARK, dir + "\n");
// 🔴 削除前の状態を必ずディスクへ残す。標準出力だけに出すと、
//    セッションが切れた時点で「削除前が何件だったか」を機械で示せなくなる。
fs.writeFileSync(path.join(path.dirname(MARK), "ui-before.json"),
  JSON.stringify({ プロファイル: dir, 状態: before }, null, 2) + "\n");
await proxy.close();   // 🔴 登録は済んだ。以降の UI 操作はローカル処理でネットワークを使わない
console.log(JSON.stringify({ プロファイル: dir, firefox_pid: pid, 削除前: before }, null, 2));
