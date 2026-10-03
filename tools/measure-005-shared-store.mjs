#!/usr/bin/env node
// measure-005-shared-store.mjs — 処理中のキーを共有ストアに置くと、2 台でも 1 回になるか（M1）
//
// 005-multiprocess-idempotency は「B（v07 準拠）の排他はプロセスの中でしか効かない」ことを測った。
// ここでは同じ測り方のまま、処理中のキーの置き場所だけを 2 台から見える所へ移した実装 C を並べる。
//
//   A        … 素朴な実装（対照）
//   B        … v07 準拠・排他はプロセス内の Set（対照）
//   C-pg     … 同じ判定を PostgreSQL の一意制約で行う
//   C-redis  … 同じ判定を Redis の SET NX で行う
//
// 測り方は 005-multiprocess-idempotency と同じ:
//   - ロードバランサは挟まず、2 本をそれぞれ別の台へ直接送る（振り分けの運不運を外す）
//   - 課金回数はプロセス内の変数なので、両方の台から読んで足す
//   - 対照として「同じ台へ 2 本」も測る
//
// 1 回きりの観測で「1 回になった」と言わないよう、各ケースを TRIALS 回くり返し、
// 課金回数と応答の組を試行ごとに記録する。409 で弾いたのか、結果を再生した 201 なのかを
// 区別するため、合計だけで判定しない。
//
// 使い方: node tools/measure-005-shared-store.mjs
// 実行前に docker compose up -d --wait しておくこと（app / app2 / idem-pg / idem-redis）。

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "005-shared-store-idempotency";
const OUT = join(ROOT, "results", ID);
const TRIALS = 20;

const NODES = [
  { id: "app", base: "http://localhost:8086" },
  { id: "app2", base: "http://localhost:8097" },
];

const IMPLS = [
  { id: "a", name: "A: 素朴な実装", path: "/005/charge-naive" },
  { id: "b", name: "B: v07 準拠（プロセス内の排他）", path: "/005/charge" },
  { id: "c_pg", name: "C: PostgreSQL の一意制約", path: "/005/charge-pg" },
  { id: "c_redis", name: "C: Redis の SET NX", path: "/005/charge-redis" },
];

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const resetAll = () => Promise.all(NODES.map((n) => fetch(`${n.base}/005/__reset`, { method: "POST" })));

async function chargedTotal() {
  let total = 0;
  for (const n of NODES) total += (await (await fetch(`${n.base}/005/__stats`)).json()).charged;
  return total;
}

function send(base, path, key) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ amount: 1000 }),
  }).then(async (r) => (r.headers.get("idempotency-replayed") === "true" ? `${r.status}r` : String(r.status)))
    .catch((e) => `ERR:${e.cause?.code ?? e.message}`);
}

/** 値ごとの出現回数を "値×回数" の昇順で並べる（再走しても並びが変わらないように） */
const tally = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([v, n]) => `${v}x${n}`).join(" ");
};

async function runCase(impl, label, targets) {
  const totals = [];
  const combos = [];
  for (let i = 0; i < TRIALS; i++) {
    await resetAll();
    const key = randomUUID();
    const statuses = await Promise.all(targets.map((t) => send(t.base, impl.path, key)));
    totals.push(await chargedTotal());
    combos.push([...statuses].sort().join("/"));
  }
  log(`## ${impl.name} / ${label}`);
  log(`   宛先: ${targets.map((t) => t.id).join(" + ")} / 試行 ${TRIALS} 回`);
  log(`   課金回数（両台の合計）: ${tally(totals)}`);
  log(`   応答の組: ${tally(combos)}`);
  log("");
  return { totals, combos };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const meta = await (await fetch(`${NODES[0].base}/__meta`)).json();
  const summary = {
    scenario: ID,
    mode: "M1",
    measured_at: new Date().toISOString(),
    server_node: meta.node,
    nodes: NODES.length,
    trials: TRIALS,
  };

  log("==========================================");
  log(`${ID} (M1) — server node ${meta.node} / 試行 ${TRIALS} 回 × ケース 8`);
  log(`measured-at: ${summary.measured_at}`);
  log("==========================================");
  log("応答の組の「201r」は、保存した結果を再生した 201（Idempotency-Replayed: true）");
  log("");

  // 共有ストアへの接続を先に張っておく。最初の試行だけ接続の確立で 2 本の到着がずれ、
  // 並行にならなくなるのを避けるため（結果には数えない）
  await resetAll();
  for (const impl of IMPLS) for (const n of NODES) await send(n.base, impl.path, randomUUID());

  for (const impl of IMPLS) {
    const same = await runCase(impl, "同じ台へ 2 本", [NODES[0], NODES[0]]);
    const two = await runCase(impl, "別々の台へ 1 本ずつ", [NODES[0], NODES[1]]);
    summary[`${impl.id}_same_instance_charged`] = tally(same.totals);
    summary[`${impl.id}_two_instances_charged`] = tally(two.totals);
    summary[`${impl.id}_same_instance_statuses`] = tally(same.combos);
    summary[`${impl.id}_two_instances_statuses`] = tally(two.combos);
  }

  const onceEveryTrial = (k) => summary[k] === `1x${TRIALS}`;
  summary.c_pg_protects_across_instances = onceEveryTrial("c_pg_two_instances_charged");
  summary.c_redis_protects_across_instances = onceEveryTrial("c_redis_two_instances_charged");
  summary.b_protects_across_instances = onceEveryTrial("b_two_instances_charged");

  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  log(`[measure-005-shared-store] ${Object.keys(summary).length} 項目を記録しました`);
}

main().catch((e) => { console.error(e); process.exit(1); });
