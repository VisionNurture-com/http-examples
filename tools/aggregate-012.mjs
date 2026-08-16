#!/usr/bin/env node
// aggregate-012.mjs — 記事 012 の生ログから summary.json を作る（M0・docker 不要）
//
// 入力: results/012-dictionary/sizes.json          … tools/make-012-artifacts.mjs の出力
//       results/012-dictionary/browser-*.json      … tools/measure-012-dictionary.mjs の出力
//       results/012-timing-api/api-surface.json    … tools/probe-012-timing-api.mjs の出力
// 出力: results/012-dictionary/summary.json / results/012-timing-api/summary.json
//
// 使い方: node tools/aggregate-012.mjs [dictionary|timing-api]

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const RESULTS = join(ROOT, "results");
const which = process.argv[2] ?? "dictionary";

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function aggregateDictionary() {
  const dir = join(RESULTS, "012-dictionary");
  const sizes = readJson(join(dir, "sizes.json"));

  const engines = {};
  const arms = {};
  for (const f of readdirSync(dir)) {
    const m = f.match(/^browser-(.+)\.json$/);
    if (!m) continue;
    const label = m[1];
    const r = readJson(join(dir, f));
    const row = {
      version: r.version,
      sendsAvailableDictionary: r.verdict["次の版の要求にAvailableDictionaryが付いたか"],
      contentEncoding: r.verdict["応答のContentEncoding"],
      servedFile: r.verdict["nginxが返したファイル"],
      encodedBodySize: r.timing?.encodedBodySize ?? null,
      decodedBodySize: r.timing?.decodedBodySize ?? null,
    };
    // 素の 4 エンジンぶんと、証明書ゲートの切り分けアームを分けて持つ
    if (label.includes("-")) arms[label] = { ...row, base: r.base, requireKnownRootCert: r.requireKnownRootCert };
    else engines[label] = row;
  }

  const summary = {
    scenario: "012-dictionary",
    mode: "M2",
    generatedAt: sizes.generatedAt,
    tools: sizes.tools,
    dictionary_bytes: sizes.dictionary.bytes,
    dictionary_sha256_base64: sizes.dictionary.sha256Base64,
    target_bytes: sizes.target.bytes,
    bytes_identity: sizes.encodings.identity.bytes,
    bytes_gzip: sizes.encodings.gzip.bytes,
    bytes_br: sizes.encodings.br.bytes,
    bytes_zstd: sizes.encodings.zstd.bytes,
    bytes_dcb: sizes.encodings.dcb.bytes,
    bytes_dcz: sizes.encodings.dcz.bytes,
    engines,
    dictionary_users: Object.entries(engines)
      .filter(([, v]) => v.sendsAvailableDictionary)
      .map(([k]) => k)
      .sort(),
    cert_gate_arms: arms,
  };

  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`results/012-dictionary/summary.json を書きました`);
  console.log(`  辞書を使ったエンジン: ${summary.dictionary_users.join(" / ") || "(なし)"}`);
  console.log(`  dcb = ${summary.bytes_dcb} バイト / br = ${summary.bytes_br} バイト`);
}

function aggregateTimingApi() {
  const dir = join(RESULTS, "012-timing-api");
  const surface = readJson(join(dir, "api-surface.json"));

  const byEngine = {};
  for (const r of surface.results) {
    if (r.launchError) continue;
    byEngine[r.label] = {
      version: r.version,
      hasFirstInterimResponseStart: r.surface.firstInterimResponseStart.resourceTiming,
      hasFinalResponseHeadersStart: r.surface.finalResponseHeadersStart.resourceTiming,
      hasFirstResponseHeadersStart: r.surface.firstResponseHeadersStart.resourceTiming,
    };
  }
  const values = Object.values(byEngine);

  const summary = {
    scenario: "012-timing-api",
    mode: "M0",
    generatedAt: surface.probedAt,
    engines: byEngine,
    // 記事が主張するのはこの 2 つ。個別の版番号ではなく「全エンジンで揃っているか」
    final_response_headers_start_everywhere: values.every((v) => v.hasFinalResponseHeadersStart),
    first_response_headers_start_nowhere: values.every((v) => !v.hasFirstResponseHeadersStart),
    engines_probed: values.length,
  };

  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`results/012-timing-api/summary.json を書きました`);
  console.log(`  finalResponseHeadersStart が全エンジンにある: ${summary.final_response_headers_start_everywhere}`);
  console.log(`  firstResponseHeadersStart はどこにも無い: ${summary.first_response_headers_start_nowhere}`);
}

function aggregateEarlyHints() {
  const dir = join(RESULTS, "012-early-hints");
  const engines = {};
  let webVitalsVersion = null;
  let thinkMs = null;

  for (const f of readdirSync(dir)) {
    const m = f.match(/^browser-(.+)\.json$/);
    if (!m) continue;
    const r = readJson(join(dir, f));
    webVitalsVersion = r.webVitalsVersion;
    thinkMs = r.thinkMs;
    const pick = (transport, cc, hints) =>
      r.rows.find((x) => x.transport === transport && x.asset_cache_control === cc && x.hints === hints);

    // 🔴 「先読みが実際に効いたか」は報告 TTFB でなく資源が揃った時刻で見る。
    //    none より明確に早ければ効いた、とする（試行間の揺れを超える差だけを拾う）
    const helped = (transport, cc) => {
      const base = pick(transport, cc, "none");
      const pre = pick(transport, cc, "preload");
      if (!base || !pre) return null;
      return pre.asset_ready_median_ms < base.asset_ready_median_ms * 0.8;
    };

    engines[r.engine] = {
      version: r.version,
      // nginx 経由で 103 がブラウザまで届いたか（全条件）
      interim_seen_via_nginx: r.rows.filter((x) => x.transport === "nginx").some((x) => x.saw_interim),
      interim_seen_direct: r.rows.filter((x) => x.transport !== "nginx").some((x) => x.saw_interim),
      // 報告 TTFB は 103 の到着で下がるか（direct・no-store・bare / none の比）
      reported_ttfb_none_ms: pick("direct", "no-store", "none")?.reported_ttfb_median_ms ?? null,
      reported_ttfb_bare_ms: pick("direct", "no-store", "bare")?.reported_ttfb_median_ms ?? null,
      // 一方でサーバの実処理時間は変わらない
      server_think_none_ms: pick("direct", "no-store", "none")?.server_think_median_ms ?? null,
      server_think_bare_ms: pick("direct", "no-store", "bare")?.server_think_median_ms ?? null,
      // RUM ライブラリが返す値は報告 TTFB と一致するか
      web_vitals_matches_reported: r.rows.every(
        (x) =>
          x.web_vitals_ttfb_median_ms == null ||
          Math.abs(x.web_vitals_ttfb_median_ms - x.reported_ttfb_median_ms) < 1
      ),
      // finalResponseHeadersStart が responseStart と別の時刻を返すか
      final_headers_separable: r.rows
        .filter((x) => x.saw_interim)
        .every((x) => x.final_headers_median_ms != null && x.final_headers_median_ms - x.reported_ttfb_median_ms > 50),
      // preload が実利得を生む条件
      preload_helps: {
        "direct/no-store": helped("direct", "no-store"),
        "direct/public": helped("direct", "public, max-age=60"),
        "h2direct/no-store": helped("h2direct", "no-store"),
        "h2direct/public": helped("h2direct", "public, max-age=60"),
      },
    };
  }

  const list = Object.values(engines);
  const summary = {
    scenario: "012-early-hints",
    mode: "M2",
    generatedAt: new Date(0).toISOString(),
    web_vitals_version: webVitalsVersion,
    think_ms: thinkMs,
    engines,
    // 記事が主張するのはこの 4 つ
    nginx_drops_interim: list.every((e) => e.interim_seen_direct && !e.interim_seen_via_nginx),
    web_vitals_reports_interim_as_ttfb: list.every((e) => e.web_vitals_matches_reported),
    webkit_cannot_separate_final_headers: engines.webkit ? !engines.webkit.final_headers_separable : null,
    engines_measured: list.length,
  };

  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log("results/012-early-hints/summary.json を書きました");
  console.log(`  nginx が 103 を落とす（全エンジン）: ${summary.nginx_drops_interim}`);
  console.log(`  web-vitals が 103 の時刻を TTFB として返す: ${summary.web_vitals_reports_interim_as_ttfb}`);
  for (const [name, e] of Object.entries(engines)) {
    const ok = Object.entries(e.preload_helps).filter(([, v]) => v).map(([k]) => k);
    console.log(`  ${name}: preload が効く条件 = ${ok.length ? ok.join(" / ") : "なし"}`);
  }
}

if (which === "dictionary") aggregateDictionary();
else if (which === "timing-api") aggregateTimingApi();
else if (which === "early-hints") aggregateEarlyHints();
else {
  console.error("使い方: node tools/aggregate-012.mjs [dictionary|timing-api|early-hints]");
  process.exit(3);
}
