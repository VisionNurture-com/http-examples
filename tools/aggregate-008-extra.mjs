#!/usr/bin/env node
// aggregate-008-extra.mjs — 008 の追加シナリオを summary.json に畳む（M0・ブラウザを起動しない）
//
// 対象:
//   cache-key     — キャッシュの鍵の粒度（fixed / echo の 2 系統）
//   wildcard-auth — Allow-Headers の * と Authorization
//   redirect      — リダイレクトを挟んだときの壊れ方
//
// 各ハーネスはブラウザごとに raw.<browser>.json を書く。ここで畳んで
// check-provenance.mjs が突合できる 1 枚にする。
//
// 使い方: node tools/aggregate-008-extra.mjs <cache-key|wildcard-auth|redirect|all>

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function readRaw(dirName) {
  const dir = join(ROOT, "results", dirName);
  if (!existsSync(dir)) throw new Error(`${dirName} がありません`);
  const files = readdirSync(dir).filter((f) => /^raw\..+\.json$/.test(f));
  if (files.length === 0) throw new Error(`${dirName}/raw.<browser>.json がありません`);
  return { dir, rows: files.flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) };
}

/** 全ブラウザで同じ値なら値を、割れたら "browsers_disagree" を返す */
function consensus(values) {
  const same = values.every((v) => v === values[0]);
  return same ? values[0] : "browsers_disagree";
}

function aggregateCacheKey() {
  const { dir, rows } = readRaw("008-cache-key");
  const browsers = [...new Set(rows.map((r) => r.browser))].sort();
  const summary = {
    browsers,
    case_count: [...new Set(rows.map((r) => r.case))].length,
    systems: [...new Set(rows.map((r) => r.system))].sort(),
  };

  for (const system of summary.systems) {
    for (const c of [...new Set(rows.map((r) => r.case))].sort()) {
      const subset = rows.filter((r) => r.system === system && r.case === c);
      const key = `${system}_${c}_second_fired`;
      summary[key] = consensus(subset.map((r) => r.second_fired));
      // 割れた場合はブラウザ別に残す。記事に一つの答えを書けないため。
      if (summary[key] === "browsers_disagree") {
        for (const r of subset) summary[`${key}_${r.browser}`] = r.second_fired;
      }
    }
  }
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`[aggregate] cache-key — ${rows.length} 行を畳みました`);
}

function aggregateWildcardAuth() {
  const { dir, rows } = readRaw("008-wildcard-auth");
  const browsers = [...new Set(rows.map((r) => r.browser))].sort();
  const summary = { browsers, case_count: [...new Set(rows.map((r) => r.case))].length };

  for (const c of [...new Set(rows.map((r) => r.case))].sort()) {
    const subset = rows.filter((r) => r.case === c);
    // ① 本番リクエストが通ったか
    summary[`${c}_fetch_ok`] = consensus(subset.map((r) => r.fetch_first_ok && r.fetch_second_ok));
    // ② 2 回目に preflight が飛んだか（キャッシュに当たらなかったか）
    const key = `${c}_second_preflight_fired`;
    summary[key] = consensus(subset.map((r) => r.preflight_second > 0));
    if (summary[key] === "browsers_disagree") {
      for (const r of subset) summary[`${key}_${r.browser}`] = r.preflight_second > 0;
    }
  }
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`[aggregate] wildcard-auth — ${rows.length} 行を畳みました`);
}

function aggregateRedirect() {
  const { dir, rows } = readRaw("008-redirect");
  const browsers = [...new Set(rows.map((r) => r.browser))].sort();
  const summary = { browsers, case_count: [...new Set(rows.map((r) => r.case))].length };

  for (const c of [...new Set(rows.map((r) => r.case))].sort()) {
    const subset = rows.filter((r) => r.case === c);
    summary[`${c}_fetch_ok`] = consensus(subset.map((r) => r.fetch_ok));
    summary[`${c}_preflight_count`] = consensus(subset.map((r) => r.preflight_count));
    const third = subset.map((r) => r.third_origin_preflights + r.third_origin_actual);
    if (third.some((n) => n > 0)) {
      summary[`${c}_third_origin_reached`] = consensus(third.map((n) => n > 0));
      // リダイレクト後に送られた Origin。null になるかどうかが失敗の分かれ目。
      summary[`${c}_third_origin_saw_null_origin`] = consensus(
        subset.map((r) => (r.third_origin_origins || []).includes("null"))
      );
      const auth = subset.map((r) => r.authorization_survived_redirect).filter((v) => v !== null);
      if (auth.length) summary[`${c}_authorization_survived`] = consensus(auth);
    }
  }
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`[aggregate] redirect — ${rows.length} 行を畳みました`);
}

function aggregatePreflightAuth() {
  const { dir, rows } = readRaw("008-preflight-auth");
  const browsers = [...new Set(rows.map((r) => r.browser))].sort();
  const summary = { browsers, case_count: [...new Set(rows.map((r) => r.case))].length };

  for (const c of [...new Set(rows.map((r) => r.case))].sort()) {
    const subset = rows.filter((r) => r.case === c);
    // ① 本番リクエストが通ったか
    summary[`${c}_fetch_ok`] = consensus(subset.map((r) => r.fetch_ok));
    // ② preflight に何が返ったか（先頭の 1 本を代表にする。401 が返れば本番は送られない）
    summary[`${c}_preflight_status`] = consensus(subset.map((r) => r.preflight_statuses[0] ?? null));
    // ③ OPTIONS が何本届いたか（401 のとき WebKit だけ再送する）
    const key = `${c}_preflight_count`;
    summary[key] = consensus(subset.map((r) => r.preflight_count));
    if (summary[key] === "browsers_disagree") {
      for (const r of subset) summary[`${key}_${r.browser}`] = r.preflight_count;
    }
  }

  // curl プローブ（M1）を畳み込む。ブラウザのハーネスは必ず Authorization を付けて送るため、
  // 「認証なしで通ってしまうか」はブラウザ側からは観測できない。
  const probePath = join(dir, "curl-probe.json");
  if (!existsSync(probePath)) {
    throw new Error("curl-probe.json がありません（tools/probe-008-preflight-auth.sh を先に実行）");
  }
  const probe = JSON.parse(readFileSync(probePath, "utf8"));
  for (const [k, v] of Object.entries(probe)) {
    if (k === "probe") continue;
    summary[`curl_${k}`] = v;
  }

  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`[aggregate] preflight-auth — ${rows.length} 行 + curl プローブ 9 値を畳みました`);
}

const which = process.argv[2];
const RUNNERS = {
  "cache-key": aggregateCacheKey,
  "wildcard-auth": aggregateWildcardAuth,
  redirect: aggregateRedirect,
  "preflight-auth": aggregatePreflightAuth,
};

if (which === "all") Object.values(RUNNERS).forEach((f) => f());
else if (RUNNERS[which]) RUNNERS[which]();
else {
  console.error(
    "usage: node tools/aggregate-008-extra.mjs <cache-key|wildcard-auth|redirect|preflight-auth|all>"
  );
  process.exit(2);
}
