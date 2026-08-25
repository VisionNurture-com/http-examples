#!/usr/bin/env node
// measure-005-timeout.mjs — 応答が返らないとき、クライアントは何秒待つか（M1）
//
// 🔴 測るのは「応答待ちのタイムアウト」だけである。
//    接続そのものが成立しない場合（到達しない宛先）は別のタイムアウトが効く。
//    こちらは測っていない。
//
// 足場: GET /005/never-responds は接続を成立させたまま応答を返さない。
//
// 🔴 サーバ側にもタイムアウトがある（Node の http.Server は requestTimeout の既定を
//    持つ）。どちら側が切ったのかを取り違えないよう、経過秒だけでなく
//    エラーの名前・コード・原因をそのまま記録する。
//
// 使い方: node tools/measure-005-timeout.mjs
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "005-fetch-timeout";
const OUT = join(ROOT, "results", ID);
const URL_ = "http://localhost:8086/005/never-responds";
const CAP_MS = 330_000; // 上限。切れなければ「上限まで切れなかった」と記録する

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const sec = (ms) => (ms / 1000).toFixed(1);

/** Node 組み込みの fetch（undici）— 既定のまま。AbortController を付けない */
async function viaNodeFetch() {
  const t0 = Date.now();
  const cap = setTimeout(() => {}, CAP_MS); // プロセスを生かす
  try {
    const ctl = new AbortController();
    const capper = setTimeout(() => ctl.abort(new Error("__CAP__")), CAP_MS);
    try {
      await fetch(URL_, { signal: ctl.signal });
      return { elapsed_ms: Date.now() - t0, outcome: "応答が返った", error: null };
    } finally { clearTimeout(capper); }
  } catch (e) {
    const capped = String(e?.cause?.message ?? e?.message ?? "").includes("__CAP__");
    return {
      elapsed_ms: Date.now() - t0,
      outcome: capped ? `上限 ${sec(CAP_MS)} 秒まで切れなかった` : "クライアント側で切れた",
      error: capped ? null : { name: e.name, code: e.code ?? e.cause?.code ?? null, message: e.cause?.message ?? e.message },
    };
  } finally { clearTimeout(cap); }
}

/** undici を直接。Node 組み込みと同じ既定値かを確かめる */
async function viaUndici() {
  const { request } = await import("undici");
  const t0 = Date.now();
  try {
    const res = await request(URL_);
    await res.body.text();
    return { elapsed_ms: Date.now() - t0, outcome: "応答が返った", error: null };
  } catch (e) {
    return {
      elapsed_ms: Date.now() - t0,
      outcome: "クライアント側で切れた",
      error: { name: e.name, code: e.code ?? null, message: e.message },
    };
  }
}

/** curl 既定（--max-time を付けない）。上限で外から止める */
function viaCurl() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn("curl", ["--silent", "--show-error", "--include", URL_]);
    let err = "";
    let killed = false;
    const capper = setTimeout(() => { killed = true; p.kill("SIGKILL"); }, CAP_MS);
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => {
      clearTimeout(capper);
      resolve({
        elapsed_ms: Date.now() - t0,
        outcome: killed ? `上限 ${sec(CAP_MS)} 秒まで切れなかった` : "クライアント側で切れた",
        error: killed ? null : { name: "curl", code, message: err.trim() || null },
      });
    });
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // mode は run.sh の `# mode:` 宣言と揃える。M2 へ降格したときにここだけ直し忘れていた
  const summary = { scenario: ID, mode: "M2", measured_at: new Date().toISOString(), cap_ms: CAP_MS };

  const meta = await (await fetch("http://localhost:8086/__meta")).json();
  const curlV = await new Promise((r) => {
    const p = spawn("curl", ["--version"]); let o = "";
    p.stdout.on("data", (d) => (o += d)); p.on("close", () => r(o.split("\n")[0]));
  });
  summary.node = meta.node;
  summary.curl = curlV;
  const undiciV = (await import("undici/package.json", { with: { type: "json" } })).default.version;
  summary.undici = undiciV;

  log("==========================================");
  log(`005-fetch-timeout (M1) — node ${meta.node} / undici ${undiciV}`);
  log(`${curlV}`);
  log(`measured-at: ${summary.measured_at} / 上限 ${sec(CAP_MS)} 秒`);
  log("==========================================");
  log("");
  log("足場: GET /005/never-responds（接続は成立・応答は返さない）");
  log("🔴 測っているのは応答待ちのタイムアウトのみ。接続タイムアウトは未測定。");
  log("");

  const [nodeFetch, undici, curl] = await Promise.all([viaNodeFetch(), viaUndici(), viaCurl()]);
  const rows = [
    ["node_fetch", "Node 組み込みの fetch（undici）", nodeFetch],
    ["undici", "undici を直接", undici],
    ["curl", "curl 既定（--max-time なし）", curl],
  ];

  for (const [key, label, r] of rows) {
    summary[`${key}_elapsed_s`] = Number(sec(r.elapsed_ms));
    summary[`${key}_outcome`] = r.outcome;
    summary[`${key}_error`] = r.error ? `${r.error.name}${r.error.code ? ` / ${r.error.code}` : ""}` : null;
    log(`  ${label}`);
    log(`    経過 ${sec(r.elapsed_ms)} 秒 — ${r.outcome}`);
    log(`    ${r.error ? `エラー: ${r.error.name} / code=${r.error.code} / ${r.error.message}` : "エラーなし"}`);
    log("");
  }

  const timedOut = rows.filter(([, , r]) => r.outcome === "クライアント側で切れた").map(([k]) => k);
  summary.timed_out_clients = timedOut;
  summary.timed_out_count = timedOut.length;
  summary.clients_total = rows.length;

  log("--- 読み取り ---");
  log(`${rows.length} 種のうち、既定で切れたのは ${timedOut.length} 種（${timedOut.join(", ") || "なし"}）`);

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
