#!/usr/bin/env node
// aggregate-008.mjs — 008 の測定結果を summary.json に畳む（M0・ブラウザを起動しない）
//
// 各ハーネスはブラウザごとに別ファイルを書く。記事に載せる値は
// ブラウザ横断で 1 枚にまとまっている必要があるため、ここで畳む。
// check-provenance.mjs はこの summary.json と expected.md を突合する。
//
// 使い方:
//   node tools/aggregate-008.mjs boundary
//   node tools/aggregate-008.mjs max-age

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const which = process.argv[2];

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function aggregateBoundary() {
  const dir = join(ROOT, "results", "008-preflight-boundary");
  const files = readdirSync(dir).filter((f) => /^boundary\..+\.json$/.test(f));
  if (files.length === 0) throw new Error("boundary.<browser>.json がありません");

  const per = files.map((f) => readJson(join(dir, f)));
  const ids = per[0].cases.map((c) => c.id);

  const summary = {
    measured_at: per.map((p) => p.measured_at).sort().at(-1),
    browsers: Object.fromEntries(per.map((p) => [p.browser, p.browser_version])),
    preflighted_count: per[0].preflighted_count,
    case_count: ids.length,
  };

  // ケースごとに、全ブラウザで判定が一致したかを記録する。
  // 割れた場合は値を書かず、割れた事実を残す（記事に一つの答えを書けないため）。
  let agree = true;
  for (const id of ids) {
    const votes = per.map((p) => p.cases.find((c) => c.id === id).preflighted);
    const same = votes.every((v) => v === votes[0]);
    if (!same) agree = false;
    summary[`preflight_${id.replace(/-/g, "_")}`] = same ? votes[0] : "browsers_disagree";
  }
  summary.all_browsers_agree = agree;

  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`[aggregate] boundary — ${ids.length} ケース / ブラウザ一致 ${agree ? "あり" : "なし"}`);
  return summary;
}

function aggregateMaxAge() {
  const dir = join(ROOT, "results", "008-cors-max-age");
  const files = readdirSync(dir).filter((f) => /\.(chromium|firefox|webkit)\.json$/.test(f));
  if (files.length === 0) throw new Error("<label>.<browser>.json がありません");

  const per = files.map((f) => readJson(join(dir, f)));
  const summary = { browsers: {}, measured_at: null };

  const at = [];
  for (const r of per) {
    summary.browsers[r.browser] = r.browser_version;
    at.push(r.started_at);

    // 再発間隔の代表値は中央値。1 秒刻みの取りこぼしを平均で薄めない。
    const gaps = r.preflight_gaps_s ?? [];
    const median = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;

    const key = `${r.label}_${r.browser}`.replace(/-/g, "_");
    summary[`${key}_preflight_count`] = r.preflight_count;
    summary[`${key}_gap_median_s`] = median;
  }
  summary.measured_at = at.sort().at(-1);

  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`[aggregate] max-age — ${per.length} 件の測定を畳みました`);
  return summary;
}

if (which === "boundary") aggregateBoundary();
else if (which === "max-age") aggregateMaxAge();
else {
  console.error("usage: node tools/aggregate-008.mjs <boundary|max-age>");
  process.exit(2);
}
