#!/usr/bin/env node
// check-structure.mjs — シナリオの構造検査（M0・docker 不要・ネットワーク不要）
//
// 検査内容:
//   1. scenarios/<id>/ に README.md / run.sh / expected.md が揃っているか
//   2. expected.md が provenance ブロック（```json）を持ち、必須キーを備えているか
//   3. run.sh が実行モード（M1 / M2 / M3）を宣言しているか
//
// clean clone から `npm ci && npm run check:structure` で動くこと。外部依存を持たない。

import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCENARIOS = join(ROOT, "scenarios");
const REQUIRED_FILES = ["README.md", "run.sh", "expected.md"];
const REQUIRED_KEYS = ["scenario", "mode", "values"];
const VALID_MODES = ["M0", "M1", "M2", "M3"];

/** expected.md から provenance ブロック（最初の ```json フェンス）を取り出す */
export function extractProvenance(text) {
  const m = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) return { ok: false, error: "```json ブロックがありません" };
  try {
    return { ok: true, data: JSON.parse(m[1]) };
  } catch (e) {
    return { ok: false, error: `JSON パース失敗: ${e.message}` };
  }
}

function listScenarios() {
  if (!existsSync(SCENARIOS)) return [];
  return readdirSync(SCENARIOS)
    .filter((n) => !n.startsWith(".") && statSync(join(SCENARIOS, n)).isDirectory())
    .sort();
}

function main() {
  const ids = listScenarios();
  const errors = [];

  console.log("==========================================");
  console.log("check-structure (M0)");
  console.log("==========================================");

  if (ids.length === 0) {
    console.log("シナリオ 0 個。骨格のみの状態です（各「測る回」で追加します）。");
    console.log("\n✅ PASS [check-structure] 検査対象なし");
    return 0;
  }

  for (const id of ids) {
    const dir = join(SCENARIOS, id);
    for (const f of REQUIRED_FILES) {
      if (!existsSync(join(dir, f))) errors.push(`${id}: ${f} がありません`);
    }

    const expectedPath = join(dir, "expected.md");
    if (existsSync(expectedPath)) {
      const p = extractProvenance(readFileSync(expectedPath, "utf8"));
      if (!p.ok) {
        errors.push(`${id}/expected.md: ${p.error}`);
      } else {
        for (const k of REQUIRED_KEYS) {
          if (!(k in p.data)) errors.push(`${id}/expected.md: キー "${k}" がありません`);
        }
        if (p.data.scenario && p.data.scenario !== id) {
          errors.push(`${id}/expected.md: scenario="${p.data.scenario}" がディレクトリ名と一致しません`);
        }
        if (p.data.mode && !VALID_MODES.includes(p.data.mode)) {
          errors.push(`${id}/expected.md: mode="${p.data.mode}" が不正（${VALID_MODES.join(" / ")}）`);
        }
      }
    }

    const runPath = join(dir, "run.sh");
    if (existsSync(runPath)) {
      const run = readFileSync(runPath, "utf8");
      if (!/#\s*mode:\s*(M[0-3])/.test(run)) {
        errors.push(`${id}/run.sh: "# mode: M1" 形式の実行モード宣言がありません`);
      }
    }
  }

  console.log(`シナリオ ${ids.length} 個を検査しました。`);
  if (errors.length > 0) {
    console.log("");
    for (const e of errors) console.log(`❌ ${e}`);
    console.log(`\n❌ FAIL [check-structure] ${errors.length} 件`);
    return 1;
  }
  console.log("\n✅ PASS [check-structure] 全シナリオが構造要件を満たしています");
  return 0;
}

process.exit(main());
