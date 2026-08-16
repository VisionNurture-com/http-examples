#!/usr/bin/env node
// measure-012-breakeven.mjs — 圧縮辞書は何回目の更新で元が取れるか（M0・docker 不要）
//
// 🔴 「初回コスト vs 再訪利得」という枠組みは、**どちらの流し方を採るかで意味が変わる**。
//
//   流し方 A: すでに配ってある資源を辞書にする（本リポジトリで測った形）
//             辞書の実体は前のデプロイの bundle-v1.js。訪問者はアプリとして
//             どのみち受け取っている。**初回の追加コストはゼロ**で、分岐点は存在しない。
//
//   流し方 B: 専用の辞書ファイルを別途配る（<link rel="compression-dictionary">）
//             辞書のバイト数ぶん最初に余分に払う。**ここで初めて分岐点が生まれる。**
//
// この 2 つを混ぜて 1 つの分岐点を出すと、存在しないコストを勘定に入れた数字になる。
//
// 使い方: node tools/measure-012-breakeven.mjs
// 出力  : results/012-breakeven/{run.log,summary.json}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "results", "012-breakeven");
const CROSSOVER = join(ROOT, "results", "012-crossover", "summary.json");

const br = (buf, q = 11) =>
  brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: q, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });

const dict = readFileSync(join(ROOT, "public", "012", "bundle-v1.js"));
// 専用辞書もワイヤでは圧縮して配る。素の大きさで勘定しない
const dictOnWire = br(dict).length;

const crossover = JSON.parse(readFileSync(CROSSOVER, "utf8"));

// 更新のたびに浮くバイト数 = 辞書なしの圧縮 − 辞書ありの差分
const rows = crossover.rows.map((r) => {
  const savedPerUpdate = r.br - r.dcb;
  return {
    changed_ratio: r.changed_ratio,
    br: r.br,
    dcb: r.dcb,
    saved_per_update: savedPerUpdate,
    // 流し方 B のみ分岐点を持つ。1 回の更新で辞書代を回収できるなら 1
    breakeven_updates_dedicated_dictionary:
      savedPerUpdate > 0 ? Math.ceil(dictOnWire / savedPerUpdate) : null,
  };
});

const summary = {
  scenario: "012-breakeven",
  mode: "M0",
  generatedAt: new Date(0).toISOString(),
  dictionary_raw_bytes: dict.length,
  dictionary_on_wire_bytes: dictOnWire,
  // 流し方 A（既存資源を辞書にする）: 初回の追加コストが無いため分岐点そのものが無い
  existing_resource_flow_has_breakeven: false,
  existing_resource_flow_extra_first_visit_bytes: 0,
  rows,
  // 記事に載せる代表値: 実際の v1 → v2（差分が小さい側）
  breakeven_updates_at_smallest_delta: rows[0]?.breakeven_updates_dedicated_dictionary ?? null,
  // 半分書き換えたときでも回収できるか
  breakeven_updates_at_half_change:
    rows.find((r) => r.changed_ratio === 0.5)?.breakeven_updates_dedicated_dictionary ?? null,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(
  join(OUT_DIR, "run.log"),
  [
    `measured-at: ${summary.generatedAt}`,
    `scenario: 012-breakeven`,
    `mode: M0`,
    `judgement: 辞書代（ワイヤ上）÷ 更新 1 回あたりの節約 = 元が取れる更新回数`,
    `---`,
    JSON.stringify({ dictionary_raw_bytes: dict.length, dictionary_on_wire_bytes: dictOnWire }),
    ...rows.map((r) => JSON.stringify(r)),
    "",
  ].join("\n")
);

console.log("流し方 A: すでに配ってある資源を辞書にする");
console.log("  初回の追加コスト = 0 バイト（訪問者はアプリとしてどのみち受け取っている）");
console.log("  → 分岐点は存在しない。1 回目の更新から得になる\n");
console.log(`流し方 B: 専用の辞書ファイルを配る（ワイヤ上 ${dictOnWire} バイト）`);
console.log("変更率   辞書なし(br)   辞書あり(dcb)   1 更新の節約   元が取れる更新回数");
for (const r of rows) {
  console.log(
    `${(r.changed_ratio * 100).toFixed(0).padStart(5)}% ${String(r.br).padStart(12)} ${String(r.dcb).padStart(14)} ` +
      `${String(r.saved_per_update).padStart(13)} ${String(r.breakeven_updates_dedicated_dictionary ?? "回収できない").padStart(18)}`
  );
}
console.log(`\n生ログ: results/012-breakeven/run.log`);
