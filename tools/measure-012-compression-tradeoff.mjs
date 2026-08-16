#!/usr/bin/env node
// measure-012-compression-tradeoff.mjs — 圧縮方式を選ぶための 3 つの目盛り（M0・docker 不要）
//
// 測るもの:
//   ①-g 圧縮レベルと費用   … 水準を上げると何バイト減り、何ミリ秒増えるか
//   ①-h 小さい応答         … どの大きさから圧縮が得になるか（下回ると逆効果）
//   ①-i コンテンツ種別差   … 種別ごとに効き方がどれだけ違うか
//
// 🔴 ①-g で測るのは「同じ入力に対する圧縮アルゴリズムの費用」であって、
//    サーバの処理能力ではない。同時接続下のスループットは測っていない（未測定）。
//    CLI の起動時間が混ざらないよう、プロセス内（node:zlib）で測る。
//
// 🔴 ①-h は中身の圧縮しやすさで境界が桁で変わる。圧縮しやすい標本と
//    しにくい標本の両方で出し、単一の閾値を提示しない。
//
// 🔴 ①-i は選んだ標本が結果を決める。種別ごとに実在ファイルを複数取り、
//    出自を全件記録してレンジで示す。1 標本から「この種別は N 倍」と書かない。
//
// 使い方: node tools/measure-012-compression-tradeoff.mjs
// 出力  : results/012-compression-tradeoff/{run.log,summary.json}

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, brotliCompressSync, zstdCompressSync, constants } from "node:zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "results", "012-compression-tradeoff");

/** 単調増加の高分解能時計。中央値を取るため複数回まわす */
function timeIt(fn, rounds = 5) {
  const times = [];
  let out = null;
  for (let i = 0; i < rounds; i++) {
    const t0 = process.hrtime.bigint();
    out = fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return { bytes: out.length, ms: Number(times[Math.floor(times.length / 2)].toFixed(3)) };
}

const gz = (buf, level) => gzipSync(buf, { level });
const br = (buf, q) =>
  brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: q, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
const zs = (buf, level) => zstdCompressSync(buf, { params: { [constants.ZSTD_c_compressionLevel]: level } });

// =====================================================================
// ①-g 圧縮レベルと費用
// =====================================================================
const target = readFileSync(join(ROOT, "public", "012", "bundle-v2.js"));

const levels = {
  gzip: [1, 6, 9],
  br: [0, 4, 5, 9, 11],
  zstd: [1, 3, 9, 19],
};

const levelRows = [];
for (const [algo, list] of Object.entries(levels)) {
  for (const lv of list) {
    const fn = algo === "gzip" ? () => gz(target, lv) : algo === "br" ? () => br(target, lv) : () => zs(target, lv);
    const { bytes, ms } = timeIt(fn);
    levelRows.push({ algo, level: lv, bytes, ms, ratio: Number((bytes / target.length).toFixed(4)) });
  }
}
// 既定でよく使われる水準を基準に、最高水準が何を買っているかを出す
const brDefault = levelRows.find((r) => r.algo === "br" && r.level === 5);
const brMax = levelRows.find((r) => r.algo === "br" && r.level === 11);

// =====================================================================
// ①-h 小さい応答では圧縮が逆効果
// =====================================================================
//
// 標本は 2 種類。圧縮しやすい方（同じ語が並ぶ JSON 風）と、しにくい方（乱数の 16 進）。
const compressible = (n) => {
  let s = "";
  while (s.length < n) s += '{"status":"ok","items":[],"page":1},';
  return Buffer.from(s.slice(0, n), "utf8");
};
// 🔴 乱数だと実行のたびに境界が動き、読者が同じ数字を再現できない。
//    種を固定した擬似乱数で「圧縮しにくい」標本を作る（xorshift32）。
const incompressible = (n) => {
  let x = 0x2545f491;
  const hex = "0123456789abcdef";
  let s2 = "";
  while (s2.length < n) {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    s2 += hex[x & 0xf] + hex[(x >> 8) & 0xf] + hex[(x >> 16) & 0xf] + hex[(x >> 24) & 0xf];
  }
  return Buffer.from(s2.slice(0, n), "utf8");
};

const SIZES = [16, 32, 48, 64, 96, 128, 192, 256, 384, 512, 1024];
const smallRows = [];
for (const kind of ["compressible", "incompressible"]) {
  for (const n of SIZES) {
    const buf = kind === "compressible" ? compressible(n) : incompressible(n);
    const g = gz(buf, 6).length;
    const b = br(buf, 5).length;
    smallRows.push({
      kind,
      bytes: buf.length,
      identity: buf.length,
      gzip: g,
      br: b,
      gzip_wins: g < buf.length,
      br_wins: b < buf.length,
    });
  }
}
const firstWin = (kind, key) => smallRows.find((r) => r.kind === kind && r[key])?.bytes ?? null;

// =====================================================================
// ①-i コンテンツ種別差
// =====================================================================
//
// 🔴 標本は実在ファイルのみ。出自を全件記録する。
//    results/ 配下の JSON は機械生成で反復が多く、手書きの JSON とは性質が違うため分けて数える。
// 🔴 標本は固定リスト。リポジトリを全走査すると、ファイルが増えるたびに
//    記事に載せた数字が再現できなくなる。出自を明示した実在ファイルだけを使う。
const SAMPLES = {
  HTML: ["public/012/index.html", "public/012/v2.html", "public/008/index.html", "public/003/override.html"],
  JavaScript: ["tools/check-provenance.mjs", "tools/aggregate-006.mjs", "tools/measure-003.mjs", "app/006-cache/routes.mjs"],
  "JSON（手書き）": ["package-lock.json", "app/package.json"],
  "JSON（機械生成）": [
    "results/012-dictionary/sizes.json",
    "results/012-crossover/summary.json",
    "results/006-etag/summary.json",
  ],
  Markdown: ["README.md", "scenarios/012-dictionary/README.md", "scenarios/006-etag/README.md"],
  既圧縮: ["public/012/bundle-v2.js.br", "public/012/bundle-v2.js.zst", "public/012/bundle-v2.js.dcb"],
};

const byType = {};
for (const [type, files] of Object.entries(SAMPLES)) {
  for (const rel of files) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    const b = br(buf, 5).length;
    (byType[type] ??= []).push({
      file: rel,
      bytes: buf.length,
      br: b,
      ratio: Number((b / buf.length).toFixed(4)),
    });
  }
}

const typeSummary = {};
for (const [type, list] of Object.entries(byType)) {
  const ratios = list.map((x) => x.ratio).sort((a, b) => a - b);
  typeSummary[type] = {
    samples: list.length,
    ratio_min: ratios[0],
    ratio_median: ratios[Math.floor(ratios.length / 2)],
    ratio_max: ratios.at(-1),
  };
}

// =====================================================================
const summary = {
  scenario: "012-compression-tradeoff",
  mode: "M0",
  generatedAt: new Date(0).toISOString(),
  node: process.version,
  // ①-g
  level_target_file: "public/012/bundle-v2.js",
  level_target_bytes: target.length,
  level_rows: levelRows,
  br11_vs_br5_bytes_saved: brDefault && brMax ? brDefault.bytes - brMax.bytes : null,
  br11_vs_br5_ms_added: brDefault && brMax ? Number((brMax.ms - brDefault.ms).toFixed(3)) : null,
  br11_vs_br5_times_slower: brDefault && brMax ? Number((brMax.ms / brDefault.ms).toFixed(1)) : null,
  // ①-h
  small_rows: smallRows,
  gzip_min_length_default_spec: 20,
  gzip_first_win_bytes_compressible: firstWin("compressible", "gzip_wins"),
  gzip_first_win_bytes_incompressible: firstWin("incompressible", "gzip_wins"),
  br_first_win_bytes_compressible: firstWin("compressible", "br_wins"),
  br_first_win_bytes_incompressible: firstWin("incompressible", "br_wins"),
  // ①-i
  type_summary: typeSummary,
  type_samples: byType,
  types_measured: Object.keys(typeSummary).sort(),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(
  join(OUT_DIR, "run.log"),
  [
    `measured-at: ${new Date(0).toISOString()}`,
    `scenario: 012-compression-tradeoff`,
    `mode: M0`,
    `judgement: 圧縮の水準 / 小さい応答の境界 / 種別差 を同じ実装（node:zlib）で測る`,
    `---`,
    ...levelRows.map((r) => JSON.stringify({ section: "level", ...r })),
    ...smallRows.map((r) => JSON.stringify({ section: "small", ...r })),
    ...Object.entries(byType).flatMap(([type, list]) =>
      list.map((x) => JSON.stringify({ section: "type", type, ...x }))
    ),
    "",
  ].join("\n")
);

console.log("=== ①-g 圧縮レベルと費用（bundle-v2.js / 100,814 バイト）===");
console.log("方式    水準   バイト     対素    中央時間(ms)");
for (const r of levelRows) {
  console.log(
    `${r.algo.padEnd(6)} ${String(r.level).padStart(4)} ${String(r.bytes).padStart(9)} ${(r.ratio * 100)
      .toFixed(2)
      .padStart(8)}% ${String(r.ms).padStart(12)}`
  );
}
if (brDefault && brMax) {
  console.log(
    `\n  br 5 → 11: ${summary.br11_vs_br5_bytes_saved} バイト減 / ${summary.br11_vs_br5_ms_added} ms 増（${summary.br11_vs_br5_times_slower} 倍遅い）`
  );
}

console.log("\n=== ①-h 圧縮が得になる大きさ ===");
console.log(`  gzip が素を下回る最小サイズ: 圧縮しやすい標本 ${summary.gzip_first_win_bytes_compressible} バイト / しにくい標本 ${summary.gzip_first_win_bytes_incompressible ?? "この範囲では無し"}`);
console.log(`  br   が素を下回る最小サイズ: 圧縮しやすい標本 ${summary.br_first_win_bytes_compressible} バイト / しにくい標本 ${summary.br_first_win_bytes_incompressible ?? "この範囲では無し"}`);
console.log(`  nginx の gzip_min_length 既定（仕様値）: 20 バイト`);

console.log("\n=== ①-i コンテンツ種別差（br -q 5・出自を固定した実在ファイル）===");
console.log("種別                標本   最小    中央    最大");
for (const [type, s] of Object.entries(typeSummary)) {
  console.log(
    `${type.padEnd(20)} ${String(s.samples).padStart(4)} ${(s.ratio_min * 100).toFixed(1).padStart(6)}% ${(
      s.ratio_median * 100
    )
      .toFixed(1)
      .padStart(6)}% ${(s.ratio_max * 100).toFixed(1).padStart(6)}%`
  );
}
console.log(`\n生ログ: results/012-compression-tradeoff/run.log`);
