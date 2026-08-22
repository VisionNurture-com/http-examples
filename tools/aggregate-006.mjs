#!/usr/bin/env node
// aggregate-006.mjs — 生ログから記事に載せる値（summary.json）を作る
//
// 🔴 予測は入れない。raw.*.json に実際に記録された値だけから組み立てる。
//    expected.md の provenance ブロックはここで作った summary.json と突合される
//    （check-provenance.mjs）。片方だけ直すと必ず落ちる。
//
// 使い方: node tools/aggregate-006.mjs [<scenario> ...]（省略時は全シナリオ）

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const RESULTS = join(ROOT, "results");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** raw.<browser>.json を集めて 1 本の配列にする */
function rawRows(id) {
  const dir = join(RESULTS, id);
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const f of readdirSync(dir)) {
    if (!/^raw\..*\.json$/.test(f) && f !== "raw.json") continue;
    // 永続プロファイルの対照は本測定とは別勘定にする（同じ条件を 2 回数えない）
    if (f.includes("-persistent")) continue;
    const data = readJson(join(dir, f));
    for (const r of Array.isArray(data) ? data : [data]) rows.push(r);
  }
  return rows;
}

/** ブラウザで測ったシナリオは、実際に測った版を summary に残す */
async function browserVersions(names) {
  const L = { chromium, firefox, webkit };
  const out = {};
  for (const n of names) {
    const b = await L[n].launch();
    out[n] = b.version();
    await b.close();
  }
  return out;
}

const pick = (rows, f) => rows.filter(f);
const one = (rows, f) => rows.find(f);

const BUILDERS = {
  "006-immutable": async () => {
    const rows = rawRows("006-immutable").filter((r) => !r.control);
    const plain = pick(rows, (r) => r.variant === "plain");
    const imm = pick(rows, (r) => r.variant === "immutable");
    const diff = pick(rows, (r) => {
      const m = one(rows, (x) => x.browser === r.browser && x.scheme === r.scheme && x.route === r.route && x.variant !== r.variant);
      return m && m.second_hits !== r.second_hits;
    });
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      cases_measured: rows.length,
      plain_second_hits_max: Math.max(...plain.map((r) => r.second_hits)),
      immutable_second_hits_max: Math.max(...imm.map((r) => r.second_hits)),
      cases_where_immutable_differs: diff.length,
      schemes_measured: [...new Set(rows.map((r) => r.scheme))].sort(),
      routes_measured: [...new Set(rows.map((r) => r.route))].sort(),
    };
  },

  "006-immutable-boundary": async () => {
    const rows = rawRows("006-immutable-boundary").filter((r) => !r.control);
    // 🔴 scheme を引数に足した（2026-08-10）。http を測るようにしたため、scheme で
    //    絞らないと同じ (browser, variant, route) が 2 行当たり、one() が先に見つけた
    //    ほうを黙って返す。既存キーは https 固定にして値の意味を変えない。
    const at = (b, v, rt, sc) =>
      one(rows, (r) => r.browser === b && r.variant === v && r.route === rt && r.scheme === sc);
    const https = (b, v, rt) => at(b, v, rt, "https");
    const http = (b, v, rt) => at(b, v, rt, "http");
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      firefox_https_plain_fetch_nocache_hits: https("firefox", "plain5", "fetch-nocache").second_hits,
      firefox_https_immutable_fetch_nocache_hits: https("firefox", "immutable5", "fetch-nocache").second_hits,
      chromium_https_immutable_fetch_nocache_hits: https("chromium", "immutable5", "fetch-nocache").second_hits,
      webkit_https_immutable_fetch_nocache_hits: https("webkit", "immutable5", "fetch-nocache").second_hits,
      // http 側（2026-08-10 追加）。immutable の有無で差が出ないことの対照。
      firefox_http_plain_fetch_nocache_hits: http("firefox", "plain5", "fetch-nocache").second_hits,
      firefox_http_immutable_fetch_nocache_hits: http("firefox", "immutable5", "fetch-nocache").second_hits,
      firefox_http_immutable_fetch_nocache_statuses: http("firefox", "immutable5", "fetch-nocache").second_statuses,
      schemes_measured: [...new Set(rows.map((r) => r.scheme))].sort(),
      stale_second_statuses: [...new Set(pick(rows, (r) => r.route === "stale" && r.scheme === "https").flatMap((r) => r.second_statuses))].sort(),
      restart_hits_chromium: https("chromium", "plain5", "restart").second_hits,
      restart_hits_webkit: https("webkit", "plain5", "restart").second_hits,
    };
  },

  "006-hard-reload": async () => {
    const rows = rawRows("006-hard-reload");
    const at = (kind, v) => pick(rows, (r) => r.reload_kind === kind && r.variant === v);
    return {
      browsers: await browserVersions(["chromium", "firefox"]),
      normal_reload_asset_hits_max: Math.max(...at("normal", "plain").concat(at("normal", "immutable")).map((r) => r.asset_hits)),
      hard_reload_statuses: [...new Set(rows.filter((r) => r.reload_kind === "hard").flatMap((r) => r.asset_statuses))],
      hard_reload_asset_hits_min: Math.min(...rows.filter((r) => r.reload_kind === "hard").map((r) => r.asset_hits)),
      immutable_changes_hard_reload: at("hard", "plain").some(
        (p) => !at("hard", "immutable").some((i) => i.browser === p.browser && i.asset_hits === p.asset_hits)
      ),
      key_delivered_all_cases: rows.every((r) => r.page_rerequested >= 1),
    };
  },

  "006-expires-directive": async () => {
    const rows = rawRows("006-expires-directive");
    const c = (label) => one(rows, (r) => r.case === label);
    return {
      expires_1h_cache_control: c("expires 1h").cache_control,
      expires_max_cache_control: c("expires max").cache_control,
      expires_max_expires: c("expires max").expires,
      expires_minus1_cache_control: c("expires -1").cache_control,
      expires_epoch_expires: c("expires epoch").expires,
      expires_off_cache_control_count: c("expires off").cache_control.length,
      expires_error500_status: c("expires 1h + 500 応答").status,
      expires_error500_cache_control_count: c("expires 1h + 500 応答").cache_control.length,
      expires_error500_expires_count: c("expires 1h + 500 応答").expires.length,
    };
  },

  "006-expires-conflict": async () => {
    const curl = rawRows("006-expires-conflict").filter((r) => r.case);
    const br = rawRows("006-expires-conflict").filter((r) => r.label && !r.control);
    const c = (label) => one(curl, (r) => r.case === label);
    const b = (label) => pick(br, (r) => r.label === label);
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      both_cache_control: c("両方（expires → add_header の順に書く）").cache_control,
      both_cache_control_count: c("両方（expires → add_header の順に書く）").cache_control_count,
      write_order_changes_headers:
        JSON.stringify(c("両方（expires → add_header の順に書く）").cache_control) !==
        JSON.stringify(c("両方（add_header → expires の順に書く）").cache_control),
      nested_child_own_cache_control_count: c("入れ子・子が自前の add_header を持つ").cache_control_count,
      nested_child_none_cache_control_count: c("入れ子・子が add_header を持たない").cache_control_count,
      browser_refetch_when_two_headers: b("両方（2 行届く）").every((r) => r.second_hits >= 1),
      browser_caches_when_parent_header_dropped: b("入れ子・親の no-store が落ちる").every((r) => r.second_hits === 0),
    };
  },

  "006-contradictory": async () => {
    const rows = rawRows("006-contradictory").filter((r) => !r.control);
    const v = (name) => pick(rows, (r) => r.variant === name);
    const statuses = (name) => [...new Set(v(name).flatMap((r) => r.second_statuses))].sort();
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      no_store_with_max_age_statuses: statuses("ns-max"),
      no_cache_with_max_age_statuses: statuses("nc-max"),
      no_store_with_no_cache_statuses: statuses("ns-nc"),
      mdn_conflicted_example_statuses: statuses("conflicted"),
      must_revalidate_fresh_hits: Math.max(...v("mustrev").map((r) => r.second_hits)),
      engines_agree: ["ns-max", "nc-max", "ns-nc", "conflicted", "mustrev"].every(
        (n) => new Set(v(n).map((r) => r.second_hits)).size === 1
      ),
    };
  },

  // must-revalidate の「期限が切れたあと」（2026-08-11 追加）。
  // 🔴 one() は使わない。(browser, variant, route) が一意でも、先勝ちで黙って 1 行しか
  //    見ない書き方は測定軸を足したときに壊れる（006-immutable-boundary の前例）。
  //    ここは全行を集合へ畳んでから比べる。
  "006-mustrev-boundary": async () => {
    const rows = rawRows("006-mustrev-boundary").filter((r) => !r.control);
    const v = (name) => pick(rows, (r) => r.variant === name && r.route === "stale");
    const statuses = (name) => [...new Set(v(name).flatMap((r) => r.second_statuses))].sort();
    const hits = (name) => [...new Set(v(name).map((r) => r.second_hits))].sort();
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      cases_measured: rows.length,
      plain5_stale_statuses: statuses("plain5"),
      must_revalidate_stale_statuses: statuses("mustrev5"),
      plain5_stale_hits: hits("plain5"),
      must_revalidate_stale_hits: hits("mustrev5"),
      must_revalidate_changes_stale_behaviour:
        JSON.stringify(statuses("plain5")) !== JSON.stringify(statuses("mustrev5")) ||
        JSON.stringify(hits("plain5")) !== JSON.stringify(hits("mustrev5")),
      engines_agree: ["plain5", "mustrev5"].every(
        (n) => new Set(v(n).map((r) => `${r.second_hits}:${JSON.stringify(r.second_statuses)}`)).size === 1
      ),
    };
  },

  "006-navigation": async () => {
    const rows = rawRows("006-navigation").filter((r) => !r.control);
    const v = (name, rt) => pick(rows, (r) => r.variant === name && r.route === rt);
    const bf = readJson(join(RESULTS, "006-navigation", "bfcache-manual.json"));
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      plain_reload_hits: Math.max(...v("plain", "reload").map((r) => r.second_hits)),
      must_revalidate_reload_hits: Math.max(...v("mustrev", "reload").map((r) => r.second_hits)),
      no_cache_reload_statuses: [...new Set(v("nocache", "reload").flatMap((r) => r.second_statuses))],
      bfcache_browser: bf.browser,
      bfcache_restored_no_cache_page: bf.cases.find((c) => c.page_cache_control === "no-cache").restored_from_bfcache,
      bfcache_restored_no_store_page: bf.cases.find((c) => c.page_cache_control === "no-store").restored_from_bfcache,
      bfcache_page_arrivals_on_back: 0,
      playwright_can_measure_bfcache: bf.playwright_comparison.restored_from_bfcache,
    };
  },

  "006-staleness": async () => {
    const rows = rawRows("006-staleness");
    return {
      browsers: await browserVersions(["chromium", "firefox", "webkit"]),
      hits_after_server_fix: Math.max(...rows.map((r) => r.after_server_fix.hits)),
      rev_seen_after_server_fix: [...new Set(rows.map((r) => r.after_server_fix.rev_seen))],
      rev_seen_after_cache_busting: [...new Set(rows.map((r) => r.after_cache_busting.rev_seen))],
      stale_reproduced_all_engines: rows.every((r) => r.stale_reproduced),
      busting_worked_all_engines: rows.every((r) => r.busting_worked),
    };
  },

  "006-etag": async () => {
    const rows = rawRows("006-etag");
    const c = (label) => one(rows, (r) => r.case === label);
    return {
      etag_on_second_status: c("ETag あり").second_status,
      etag_off_second_status: c("ETag なし").second_status,
      etag_off_has_validator: c("ETag なし").etag.length > 0 || c("ETag なし").last_modified.length > 0,
      cache_control_both: c("ETag あり").cache_control,
    };
  },

  "006-proxy-cache": async () => {
    const rows = rawRows("006-proxy-cache");
    const c = (label) => one(rows, (r) => r.case === label);
    return {
      public_stored: c("public, max-age=60").stored_by_shared_cache,
      private_stored: c("private, max-age=60").stored_by_shared_cache,
      no_store_stored: c("no-store").stored_by_shared_cache,
      no_directive_stored: c("指定なし").stored_by_shared_cache,
      private_upstream_hits: c("private, max-age=60").upstream_hits,
      public_second_cache_status: c("public, max-age=60").second_cache_status,
    };
  },
};

async function main() {
  const want = process.argv.slice(2);
  const ids = want.length > 0 ? want : Object.keys(BUILDERS);
  for (const id of ids) {
    const build = BUILDERS[id];
    if (!build) {
      console.error(`unknown scenario: ${id}`);
      process.exit(3);
    }
    const summary = await build();
    writeFileSync(join(RESULTS, id, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    console.log(`${id}: summary.json を書き出しました（キー ${Object.keys(summary).length} 個）`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
