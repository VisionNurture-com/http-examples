#!/usr/bin/env node
// measure-005-idempotency.mjs — 冪等キーを付けたのに二重登録が起きる境界（M1）
//
// draft-ietf-httpapi-idempotency-key-header-07 は 3 つのステータスコードを SHOULD で定める。
//   400 … Idempotency-Key がない
//   422 … 同じキーを別のリクエストペイロードで使い回した
//   409 … 元のリクエストがまだ処理中なのに再送した
// 保存期間の具体値は定めていない（資源側が決めて文書に書く、が SHOULD）。
//
// 🔴 ドラフトは 2026-04-18 に失効している。「デファクト標準」の実体は、
//    失効した仕様と、それに完全には従わない実装の集まりである。
//
// A / B 対照を同じサーバへ同じ攻め方で当てる:
//   A = /005/charge-naive … 素朴な実装（キーは見るが境界を実装していない）
//   B = /005/charge       … v07 準拠
//
// 🔴 発見は A 側にある。B が仕様どおり動くのは、こちらが仕様どおりに書いたからで
//    あって発見ではない。B は対照である。
//
// 使い方: node tools/measure-005-idempotency.mjs
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "005-idempotency-compliance";
const OUT = join(ROOT, "results", ID);
const BASE = "http://localhost:8086"; // Express 直（プロキシを挟まない対照）

const SIDES = [
  { id: "A", name: "素朴な実装", path: "/005/charge-naive" },
  { id: "B", name: "v07 準拠", path: "/005/charge" },
];

const lines = [];
const summary = { scenario: ID, mode: "M1", measured_at: new Date().toISOString() };

const log = (s) => { lines.push(s); console.log(s); };

async function reset() {
  await fetch(`${BASE}/005/__reset`, { method: "POST" });
}
async function stats() {
  return (await fetch(`${BASE}/005/__stats`)).json();
}

/** 1 回の POST。ステータスと replay ヘッダだけを読む（本文の値は判定に使わない） */
async function post(path, key, amount, query = "") {
  const headers = { "content-type": "application/json" };
  if (key !== null) headers["idempotency-key"] = key;
  const res = await fetch(`${BASE}${path}${query}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ amount }),
  });
  return { status: res.status, replayed: res.headers.get("idempotency-replayed") === "true" };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });

  const meta = await (await fetch(`${BASE}/__meta`)).json();
  summary.node = meta.node;
  log("==========================================");
  log(`005-idempotency-compliance (M1) — node ${meta.node}`);
  log(`measured-at: ${summary.measured_at}`);
  log("==========================================");
  log("");
  log("仕様 = draft-ietf-httpapi-idempotency-key-header-07（2026-04-18 失効・rev 07）");
  log("");

  for (const side of SIDES) {
    log(`--- ${side.id}: ${side.name}（${side.path}）---`);

    // K1: キーなしで POST
    await reset();
    const k1 = await post(side.path, null, 1000);
    const k1stats = await stats();
    summary[`${side.id}_K1_status`] = k1.status;
    summary[`${side.id}_K1_charged`] = k1stats.charged;
    log(`  K1 キーなし            → ${k1.status} / 課金処理 ${k1stats.charged} 回`);

    // K2: 同一キー・別ペイロード
    await reset();
    await post(side.path, "k2", 1000);
    const k2 = await post(side.path, "k2", 9999);
    const k2stats = await stats();
    summary[`${side.id}_K2_status`] = k2.status;
    summary[`${side.id}_K2_replayed`] = k2.replayed;
    summary[`${side.id}_K2_charged`] = k2stats.charged;
    log(`  K2 同一キー・別金額    → ${k2.status}${k2.replayed ? "（前の結果を再生）" : ""} / 課金処理 ${k2stats.charged} 回`);

    // K3: 同一キーを同時 2 本
    await reset();
    const k3 = await Promise.all([post(side.path, "k3", 1000), post(side.path, "k3", 1000)]);
    const k3stats = await stats();
    const k3codes = k3.map((r) => r.status).sort();
    summary[`${side.id}_K3_statuses`] = k3codes;
    summary[`${side.id}_K3_charged`] = k3stats.charged;
    log(`  K3 同一キー・同時 2 本 → ${k3codes.join(" / ")} / 課金処理 ${k3stats.charged} 回${k3stats.charged > 1 ? "  🔴 二重登録" : ""}`);

    // K4: 保存期間の経過後に同一キー
    await reset();
    const q = side.id === "B" ? "?ttl_ms=50" : "";
    await post(side.path, "k4", 1000, q);
    await sleep(150);
    const k4 = await post(side.path, "k4", 1000, q);
    const k4stats = await stats();
    summary[`${side.id}_K4_status`] = k4.status;
    summary[`${side.id}_K4_replayed`] = k4.replayed;
    summary[`${side.id}_K4_charged`] = k4stats.charged;
    log(`  K4 期限後に同一キー    → ${k4.status}${k4.replayed ? "（前の結果を再生）" : ""} / 課金処理 ${k4stats.charged} 回`);
    log("");
  }

  // --- 読み取り ---
  summary.spec_codes = [400, 422, 409];
  summary.A_matches_spec = [
    summary.A_K1_status === 400,
    summary.A_K2_status === 422,
    summary.A_K3_statuses.includes(409),
  ].filter(Boolean).length;
  summary.B_matches_spec = [
    summary.B_K1_status === 400,
    summary.B_K2_status === 422,
    summary.B_K3_statuses.includes(409),
  ].filter(Boolean).length;
  summary.A_double_charged = summary.A_K3_charged > 1;
  summary.B_double_charged = summary.B_K3_charged > 1;

  log("--- 読み取り ---");
  log(`仕様が定める 3 コード（400 / 422 / 409）のうち、A は ${summary.A_matches_spec} 件 / B は ${summary.B_matches_spec} 件を返した`);
  log(`同一キーの同時 2 本で二重登録が起きたか — A: ${summary.A_double_charged ? "起きた" : "起きない"} / B: ${summary.B_double_charged ? "起きた" : "起きない"}`);
  log("");
  log("🔴 K4 の秒数は測定用に縮めた値であり、記事に載せる実効値ではない。");
  log("   v07 は保存期間の値を定めていない（資源側が決めて文書に書く、が SHOULD）。");

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
