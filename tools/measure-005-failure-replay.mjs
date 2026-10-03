#!/usr/bin/env node
// measure-005-failure-replay.mjs — 失敗した結果を保存するかで、送り直しの結果がどう変わるか（M1）
//
// 課金は済んだのに、その直後に失敗して 500 を返した、という場面を作る。
// 呼び出し側には「どこまで進んだか分からない失敗」しか見えないので、同じキーで送り直す。
//
//   B       … 失敗した結果を保存しない（記事の v07 準拠の実装）
//   B-save  … 失敗した結果も保存し、同じキーの送り直しには保存した 500 を返す
//             （Stripe の公開ドキュメントと同じ方針）
//
// 1 本目には測定用の口 ?fail_after_charge=1 を付け、課金のあとで失敗させる。
// 2 本目は同じキー・同じ本文で、口を付けずに送る（指紋はパスと本文だけで作るので一致する）。
//
// 使い方: node tools/measure-005-failure-replay.mjs
// 実行前に docker compose up -d --wait しておくこと。

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "005-failure-replay";
const OUT = join(ROOT, "results", ID);
const TRIALS = 20;
const BASE = "http://localhost:8086";

const IMPLS = [
  { id: "b", name: "B: 失敗を保存しない", path: "/005/charge" },
  { id: "b_save", name: "B-save: 失敗も保存する", path: "/005/charge-save-failures" },
];

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

async function send(path, key, query = "") {
  const r = await fetch(`${BASE}${path}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ amount: 1000 }),
  });
  await r.arrayBuffer();
  return r.headers.get("idempotency-replayed") === "true" ? `${r.status}r` : String(r.status);
}

const tally = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([v, n]) => `${v}x${n}`).join(" ");
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const meta = await (await fetch(`${BASE}/__meta`)).json();
  const summary = { scenario: ID, mode: "M1", measured_at: new Date().toISOString(), server_node: meta.node, trials: TRIALS };

  log("==========================================");
  log(`${ID} (M1) — server node ${meta.node} / 試行 ${TRIALS} 回`);
  log(`measured-at: ${summary.measured_at}`);
  log("==========================================");
  log("1 本目: 課金のあとで失敗させる（?fail_after_charge=1）→ 2 本目: 同じキーで送り直す");
  log("応答の「500r」は、保存した 500 を再生したもの（Idempotency-Replayed: true）");
  log("");

  for (const impl of IMPLS) {
    const first = [];
    const second = [];
    const totals = [];
    for (let i = 0; i < TRIALS; i++) {
      await fetch(`${BASE}/005/__reset`, { method: "POST" });
      const key = randomUUID();
      first.push(await send(impl.path, key, "?fail_after_charge=1"));
      second.push(await send(impl.path, key));
      totals.push((await (await fetch(`${BASE}/005/__stats`)).json()).charged);
    }
    log(`## ${impl.name}`);
    log(`   1 本目の応答: ${tally(first)}`);
    log(`   2 本目の応答: ${tally(second)}`);
    log(`   課金回数: ${tally(totals)}`);
    log("");
    summary[`${impl.id}_first_statuses`] = tally(first);
    summary[`${impl.id}_retry_statuses`] = tally(second);
    summary[`${impl.id}_charged`] = tally(totals);
  }

  summary.b_charges_twice_after_failure = summary.b_charged === `2x${TRIALS}`;
  summary.b_save_charges_once_after_failure = summary.b_save_charged === `1x${TRIALS}`;

  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  log(`[measure-005-failure-replay] ${Object.keys(summary).length} 項目を記録しました`);
}

main().catch((e) => { console.error(e); process.exit(1); });
