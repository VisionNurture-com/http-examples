#!/usr/bin/env node
// check-provenance.mjs — 記事に載せる値と実測ログの突合（M0・docker 不要・ネットワーク不要）
//
// 突合の経路（README「数値の出どころ」と同じ）:
//   run.sh 実行 → results/<id>/run.log（生ログ）
//                → results/<id>/summary.json（実効値・機械が読む）
//                → scenarios/<id>/expected.md（記事に載せる値の正本）
//
// 本スクリプトは expected.md の provenance ブロックと summary.json を突合し、
// 食い違えば非ゼロで終了する。これが「設定値の陳腐化検知」の実体。
//
// あわせて config_refs（nginx/conf.d/*.conf 等）の実在と、引用断片が
// 実際にその設定ファイルへ含まれるかを検査する。記事に書いたが通していない
// 設定を構造的に防ぐため。
//
// リポジトリ内のファイル同士を突き合わせるだけなので clean clone で確実に動く。
//
// 使い方:
//   node tools/check-provenance.mjs                  # 全シナリオ（既定・CI と自己検査用）
//   node tools/check-provenance.mjs --prefix 006     # 006 で始まるシナリオだけ
//   npm run check:provenance -- --prefix 006         # npm 経由で渡す場合
//
// --prefix を設けた理由（2026-08-12）:
//   scenarios/ は記事を書くたびに増える。記事が「シナリオ N 個 / 突合した値 M 件」という
//   **リポ全体の総数**を載せていると、次の記事が 1 つ足した時点で読者が再現できなくなる。
//   実際 008 の記事は「シナリオ 8 個 / 118 件」を載せたまま、リポは 19 個 / 206 件になっていた。
//   記事は自分の分だけを載せられるようにし、リポの成長から切り離す。
//
// 終了コード: 0 = PASS / 1 = FAIL / 3 = 使い方エラー

import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCENARIOS = join(ROOT, "scenarios");
const RESULTS = join(ROOT, "results");

function extractProvenance(text) {
  const m = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) return { ok: false, error: "```json ブロックがありません" };
  try {
    return { ok: true, data: JSON.parse(m[1]) };
  } catch (e) {
    return { ok: false, error: `JSON パース失敗: ${e.message}` };
  }
}

/** 値の比較。数値と文字列の取り違えを見逃さないため型も見る */
function sameValue(a, b) {
  if (typeof a !== typeof b) return false;
  if (typeof a === "object" && a !== null) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/**
 * results/<id>/ にある生ファイルから、実際に測ったブラウザの集合を得る。
 *
 * 生ファイルの中身の形はシナリオごとに違う（dict のものも list のものもある）ため、
 * 中身ではなくファイル名の慣習 `<name>.<browser>.json` で判定する。
 * この慣習は aggregate-008.mjs の集計側も同じ正規表現で使っている。
 */
function browsersFromRawFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = new Set();
  for (const f of readdirSync(dir)) {
    const m = f.match(/\.(chromium|firefox|webkit)\.json$/);
    if (m) found.add(m[1]);
  }
  return [...found].sort();
}

/** summary.json の browsers は dict（browser → version）か配列のどちらもありうる */
function browsersFromSummary(summary) {
  const b = summary?.browsers;
  if (!b) return [];
  return (Array.isArray(b) ? [...b] : Object.keys(b)).sort();
}

function listScenarios() {
  if (!existsSync(SCENARIOS)) return [];
  return readdirSync(SCENARIOS)
    .filter((n) => !n.startsWith(".") && statSync(join(SCENARIOS, n)).isDirectory())
    .sort();
}

// 引数解析。**未知の引数は落とす**（黙って無視すると「絞ったつもりで全件」または
// 「全件のつもりで 0 件」を PASS として出してしまう。黙って通る検査は無いのと同じ）。
function parseArgs(argv) {
  let prefix = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prefix") {
      prefix = argv[++i] ?? "";
    } else if (a.startsWith("--prefix=")) {
      prefix = a.slice("--prefix=".length);
    } else {
      console.error(`✗ USAGE [check-provenance] 未知の引数: "${a}"`);
      console.error("  使い方: node tools/check-provenance.mjs [--prefix <シナリオ ID の接頭辞>]");
      process.exit(3);
    }
    if (prefix !== null && prefix.trim() === "") {
      console.error("✗ USAGE [check-provenance] --prefix には値が必要です");
      process.exit(3);
    }
  }
  return { prefix };
}

function main() {
  const { prefix } = parseArgs(process.argv.slice(2));
  const all = listScenarios();
  const ids = prefix ? all.filter((id) => id.startsWith(prefix)) : all;
  const errors = [];
  let compared = 0;

  console.log("==========================================");
  console.log("check-provenance (M0)");
  console.log("==========================================");

  // 絞り込んだのに 0 件は **FAIL**。ここを PASS にすると「検査したつもりで 1 件も見ていない」
  // 状態が通ってしまう（--prefix 006 の打ち間違いが緑で返る）。
  if (prefix && ids.length === 0) {
    console.log(`❌ FAIL [check-provenance] "--prefix ${prefix}" に一致するシナリオがありません（全 ${all.length} 個）`);
    return 1;
  }

  if (ids.length === 0) {
    console.log("シナリオ 0 個。骨格のみの状態です（測定を追加すると増えます）。");
    console.log("\n✅ PASS [check-provenance] 検査対象なし");
    return 0;
  }

  for (const id of ids) {
    const expectedPath = join(SCENARIOS, id, "expected.md");
    if (!existsSync(expectedPath)) {
      errors.push(`${id}: expected.md がありません`);
      continue;
    }
    const p = extractProvenance(readFileSync(expectedPath, "utf8"));
    if (!p.ok) {
      errors.push(`${id}/expected.md: ${p.error}`);
      continue;
    }
    const { values = {}, config_refs = [], mode, browsers: declaredBrowsers } = p.data;

    // --- 1. summary.json との突合 ---
    const summaryPath = join(RESULTS, id, "summary.json");
    if (!existsSync(summaryPath)) {
      errors.push(`${id}: results/${id}/summary.json がありません（測定が未実施か生ログ未保存）`);
    } else {
      let summary;
      try {
        summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      } catch (e) {
        errors.push(`${id}/summary.json: JSON パース失敗: ${e.message}`);
        summary = null;
      }
      if (summary) {
        for (const [k, want] of Object.entries(values)) {
          if (!(k in summary)) {
            errors.push(`${id}: summary.json に "${k}" がありません（記事に載せる値の裏づけなし）`);
          } else if (!sameValue(want, summary[k])) {
            errors.push(
              `${id}: "${k}" が乖離 — expected.md=${JSON.stringify(want)} / summary.json=${JSON.stringify(summary[k])}`
            );
          } else {
            compared++;
          }
        }
      }
    }

    // --- 1b. 集計の網羅と宣言の一致 ---
    //
    // 「測ったのに集計に入っていない」「expected.md の宣言が古い」を検出する。
    // 2026-08-08 に 008-preflight-boundary で実際に起きた見落としへの対処:
    //   WebKit を追加実行したのに summary.json が再集計されておらず、
    //   記事の「3 エンジンで一致」という主張を本スクリプトが検査していなかった。
    const rawBrowsers = browsersFromRawFiles(join(RESULTS, id));
    if (rawBrowsers.length > 0) {
      const summaryPath2 = join(RESULTS, id, "summary.json");
      let summaryBrowsers = [];
      if (existsSync(summaryPath2)) {
        try {
          summaryBrowsers = browsersFromSummary(JSON.parse(readFileSync(summaryPath2, "utf8")));
        } catch {
          /* パース失敗は上の検査 1 で報告済み */
        }
      }
      const notAggregated = rawBrowsers.filter((b) => !summaryBrowsers.includes(b));
      if (notAggregated.length > 0) {
        errors.push(
          `${id}: 生ファイルに ${JSON.stringify(notAggregated)} があるのに summary.json に含まれていません` +
            `（再集計が必要: node tools/aggregate-008.mjs <name>）`
        );
      }
      if (!Array.isArray(declaredBrowsers)) {
        errors.push(
          `${id}/expected.md: ブラウザで測るシナリオには "browsers" 宣言が必要です（例: ["chromium","firefox","webkit"]）`
        );
      } else {
        const declared = [...declaredBrowsers].sort();
        if (JSON.stringify(declared) !== JSON.stringify(summaryBrowsers)) {
          errors.push(
            `${id}: "browsers" の宣言が集計と乖離 — expected.md=${JSON.stringify(declared)} / summary.json=${JSON.stringify(summaryBrowsers)}`
          );
        } else {
          compared++;
        }
      }
    }

    // --- 2. run.log の実在（生ログが残っているか）---
    if (!existsSync(join(RESULTS, id, "run.log"))) {
      errors.push(`${id}: results/${id}/run.log がありません（生ログは要約で代替しない）`);
    }

    // --- 3. 設定の正本との突合 ---
    for (const ref of config_refs) {
      const refPath = typeof ref === "string" ? ref : ref.path;
      const snippet = typeof ref === "string" ? null : ref.must_contain;
      if (!refPath) {
        errors.push(`${id}: config_refs の要素に path がありません`);
        continue;
      }
      const abs = join(ROOT, refPath);
      if (!existsSync(abs)) {
        errors.push(`${id}: config_refs "${refPath}" が実在しません`);
        continue;
      }
      if (snippet) {
        const conf = readFileSync(abs, "utf8");
        const needles = Array.isArray(snippet) ? snippet : [snippet];
        for (const n of needles) {
          if (!conf.includes(n)) {
            errors.push(`${id}: "${refPath}" に断片 ${JSON.stringify(n)} がありません（記事の引用と設定が乖離）`);
          }
        }
      }
    }

    // --- 4. M2 / M3 は CI で回らないため測定条件の記録を必須にする ---
    if (mode === "M2" || mode === "M3") {
      const logPath = join(RESULTS, id, "run.log");
      if (existsSync(logPath)) {
        const head = readFileSync(logPath, "utf8").split("\n").slice(0, 10).join("\n");
        if (!/measured-at:/.test(head)) {
          errors.push(`${id}: ${mode} の run.log 先頭に "measured-at:" がありません（CI で回らない測定は実施条件の記録が必須）`);
        }
      }
    }
  }

  console.log(
    prefix
      ? `${prefix} のシナリオ ${ids.length} 個 / 突合した値 ${compared} 件`
      : `シナリオ ${ids.length} 個 / 突合した値 ${compared} 件`
  );
  if (errors.length > 0) {
    console.log("");
    for (const e of errors) console.log(`❌ ${e}`);
    console.log(`\n❌ FAIL [check-provenance] ${errors.length} 件`);
    return 1;
  }
  console.log("\n✅ PASS [check-provenance] 記事に載せる値はすべて実測ログに裏づけられています");
  return 0;
}

process.exit(main());
