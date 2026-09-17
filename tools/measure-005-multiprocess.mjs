#!/usr/bin/env node
// measure-005-multiprocess.mjs — 冪等キーの排他は 1 プロセスの中でしか効かない（M1）
//
// 記事 005 は「キーの生成・保存・排他」の 3 か所を柱に据えている。
// そのうち排他は `const inFlight = new Set()` というプロセス内の変数で実装されており、
// サーバを 2 台に分けた時点で 2 本目を弾けなくなる。記事は本文 1 行で断っているだけで、
// 測っていなかった。ここを測る。
//
// 🔴 ロードバランサは挟まない。振り分けの運不運に結果が左右されると、
//    「たまたま同じ台に落ちたから弾けた」のか「排他が効いた」のかを分けられない。
//    2 本をそれぞれ別のインスタンスへ直接送れば、機序をそのまま観測できる。
//
// 🔴 課金回数もプロセス内の変数なので、両方のインスタンスから読んで足す。
//    片方だけを読むと、もう片方で走った課金が見えない。
//
// 対照:
//   control … 同じインスタンスへ同時 2 本（既存 K3 と同じ条件）
//   test    … 別インスタンスへ同時 2 本
//
// 使い方: node tools/measure-005-multiprocess.mjs
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "005-multiprocess-idempotency";
const OUT = join(ROOT, "results", ID);

const NODES = [
  { id: "app", base: "http://localhost:8086" },
  { id: "app2", base: "http://localhost:8097" },
];

const SIDES = [
  { id: "A", name: "素朴な実装", path: "/005/charge-naive" },
  { id: "B", name: "v07 準拠", path: "/005/charge" },
];

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const resetAll = () => Promise.all(NODES.map((n) => fetch(`${n.base}/005/__reset`, { method: "POST" })));

async function chargedTotal() {
  const per = {};
  let total = 0;
  for (const n of NODES) {
    const s = await (await fetch(`${n.base}/005/__stats`)).json();
    per[n.id] = s.charged;
    total += s.charged;
  }
  return { per, total };
}

function send(base, path, key) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ amount: 1000 }),
  }).then((r) => r.status).catch((e) => `ERR:${e.cause?.code ?? e.message}`);
}

async function run(label, side, targets) {
  await resetAll();
  const key = randomUUID();
  const statuses = await Promise.all(targets.map((t) => send(t.base, side.path, key)));
  const { per, total } = await chargedTotal();
  log(`## ${side.id}（${side.name}）/ ${label}`);
  log(`   宛先: ${targets.map((t) => t.id).join(" + ")}`);
  log(`   応答: ${statuses.join(" / ")}`);
  log(`   課金回数: ${JSON.stringify(per)} 合計 ${total}`);
  log("");
  return { statuses, per, total };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const summary = { scenario: ID, mode: "M1", measured_at: new Date().toISOString(), nodes: NODES.length };

  for (const side of SIDES) {
    const ctl = await run("control（同じインスタンスへ 2 本）", side, [NODES[0], NODES[0]]);
    const tst = await run("test（別インスタンスへ 1 本ずつ）", side, [NODES[0], NODES[1]]);
    const k = side.id.toLowerCase();
    summary[`${k}_same_instance_charged`] = ctl.total;
    summary[`${k}_two_instances_charged`] = tst.total;
    // 🔴 同時に送った 2 本のうちどちらが 409 を受けるかは実行ごとに変わる。
    // 生の順序を突合キーにすると再走のたびに落ちるため、昇順に並べてから記録する
    // （どのコードが出たかは保つ。順序は測定値ではない）。
    summary[`${k}_same_instance_statuses`] = [...ctl.statuses].sort().join(",");
    summary[`${k}_two_instances_statuses`] = [...tst.statuses].sort().join(",");
  }

  // 記事に載せる一行。B は同じ台なら 1 回に抑えるが、台が分かれると抑えられない。
  summary.spec_impl_protects_single_instance = summary.b_same_instance_charged === 1;
  summary.spec_impl_protects_across_instances = summary.b_two_instances_charged === 1;

  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  log(`[measure-005-multiprocess] ${Object.keys(summary).length} 項目を記録しました`);
}

main().catch((e) => { console.error(e); process.exit(1); });
