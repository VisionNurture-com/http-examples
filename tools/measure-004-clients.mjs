#!/usr/bin/env node
// measure-004-clients.mjs — 429 + Retry-After に、言語ごとの HTTP クライアントは従うか
//
// 使い方:
//   node tools/measure-004-clients.mjs
//
// 🔴 CI では回りません（5 つの言語ランタイムを要するため）。run.sh の mode: M2 は
//    「手元でのみ回る」の意味で、ブラウザを使うという意味ではありません。
//
// 🔴 判定はサーバ側の到着間隔で行います（measure-004.mjs と同じ規約）。
//    クライアントが自分で報告した待ち時間は使いません。
//
// 前提: docker compose up -d --wait

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const RESULTS = join(ROOT, "results");
const ACCESS_LOG = join(RESULTS, "004-status", "access.log");
const EDGE = "http://localhost:8088";
const RA = 3;
const ID = "004-retry-clients";

const CLIENTS = [
  // [ラベル, コマンド, 引数, 期待する立場]
  ["python-urllib3-retry", "python3", ["tools/004-clients/retry_urllib3.py"], "再試行を明示的に設定した側"],
  ["python-requests", "python3", ["tools/004-clients/retry_requests.py"], "同じ urllib3 の上に載る素の呼び出し"],
  ["java-httpclient", "java", ["tools/004-clients/Retry.java"], "java.net.http（再試行の設定なし）"],
  ["go-nethttp", "go", ["run", "tools/004-clients/retry.go"], "net/http（再試行の設定なし）"],
  ["ruby-nethttp", "ruby", ["tools/004-clients/retry.rb"], "Net::HTTP（再試行の設定なし）"],
  ["bun-fetch", "bun", ["tools/004-clients/retry_bun.ts"], "Web 標準の fetch"],
];

function arrivalsSince(startMsec, cl) {
  if (!existsSync(ACCESS_LOG)) return [];
  const rows = [];
  for (const line of readFileSync(ACCESS_LOG, "utf8").split("\n")) {
    const m = line.match(/^(\d+\.\d+)\s/);
    if (!m) continue;
    const t = Number(m[1]);
    if (t < startMsec) continue;
    if (!new RegExp(`cl=${cl}(\\s|$)`).test(line)) continue;
    rows.push({ t, line });
  }
  return rows;
}

function gaps(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) out.push(Math.round(rows[i].t - rows[i - 1].t));
  return out;
}

function verdict(count, gapList) {
  if (count <= 1) return "no_retry";
  return Math.min(...gapList) >= RA - 1 ? "waited" : "immediate";
}

const log = [`# ${ID}`, `measured-at: ${new Date().toISOString()}`, `retry-after: ${RA}`, ""];
const summary = { retry_after_seconds: RA };
const versions = {};

spawnSync("curl", ["-sS", "-X", "POST", `${EDGE}/004/api/__reset`], { encoding: "utf8" });

for (const [cl, cmd, args, note] of CLIENTS) {
  const url = `${EDGE}/004/api/limited?cs=clients&cl=${cl}&after=0&ra=${RA}`;
  const start = Date.now() / 1000 - 1;
  const r = spawnSync(cmd, [...args, url], { cwd: ROOT, encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  // 各スクリプトは最後に版を返す（`ランタイム名=版`）。
  // 🔴 `status=429 ...` も `名前=値` の形なので、ランタイム名を明示して拾う
  const v = out
    .split("\n")
    .reverse()
    .find((l) => /^(urllib3|requests|java|go|ruby|bun)=/.test(l.trim()));
  if (v) versions[cl] = v.trim();

  const rows = arrivalsSince(start, cl);
  const g = gaps(rows);
  summary[`arrivals_${cl}`] = rows.length;
  summary[`gaps_${cl}`] = g;
  summary[`verdict_${cl}`] = verdict(rows.length, g);

  log.push(`## ${cl}（${note}）`);
  log.push(`$ ${cmd} ${args.join(" ")} <url>`);
  for (const line of out.split("\n")) log.push(`  ${line}`);
  log.push(`  到着 ${rows.length} 回 / gaps=${JSON.stringify(g)} / 判定=${summary[`verdict_${cl}`]}`);
  for (const row of rows) log.push(`    ${row.line}`);
  log.push("");
}

summary.clients_tested = CLIENTS.map(([cl]) => cl);
summary.clients_waited = CLIENTS.map(([cl]) => cl).filter((cl) => summary[`verdict_${cl}`] === "waited");
summary.runtime_versions = versions;

mkdirSync(join(RESULTS, ID), { recursive: true });
writeFileSync(join(RESULTS, ID, "run.log"), log.join("\n") + "\n");
writeFileSync(join(RESULTS, ID, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`[${ID}] 待って再送したのは ${summary.clients_waited.length} / ${CLIENTS.length}: ${JSON.stringify(summary.clients_waited)}`);
