#!/usr/bin/env node
// measure-004.mjs — 記事 004（401 か 403 か：ステータスを選ぶ）の測定
//
// 使い方:
//   node tools/measure-004.mjs --scenario=004-auth-challenge
//   node tools/measure-004.mjs --scenario=004-retry-after   （M2・curl の版に依存）
//   node tools/measure-004.mjs --scenario=004-retry-undici  （M1・package-lock が版を固定）
//   node tools/measure-004.mjs --scenario=004-proxy-intercept
//   node tools/measure-004.mjs --scenario=004-proxy-cache
//   node tools/measure-004.mjs --scenario=004-cache-varnish
//   node tools/measure-004.mjs --scenario=004-waf
//   node tools/measure-004.mjs --scenario=004-auth-oauth-error
//
// 測る対象:
//   コードは「汎用 HTTP ソフト向け」で詳細は本文へ、という分担を RFC 9457 §1 が
//   既に書いている。ならばその汎用ソフトは、コードを見て実際に何を変えるのか。
//
// 🔴 判定の規約 1: Retry-After に「従ったか」はクライアント側の時刻で測らない。
//    クライアントのログは自分の実装を測っているだけになる。判定はサーバ側の
//    到着間隔（nginx の $msec）で行う（002 / 006 と同じ規約）。
//
// 🔴 判定の規約 2: 「再送が来なかった」は「従った」ではない。判定は 3 値にする。
//      no_retry      … そもそも再送しない
//      immediate     … Retry-After を無視して即座に再送した
//      waited        … Retry-After の秒数だけ待って再送した
//
// 🔴 判定の規約 3: nginx -v / curl -V は stderr に書く。stdout だけを拾うと版欄が空になる。
//
// 🔴 再実行の汚染: 到着記録は追記される。シナリオ開始時刻より後の行だけを集計し、
//    レート制限のカウンタは POST /004/api/__reset で初期化する。
//
// 前提: docker compose up -d --wait

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { request, RetryAgent, Agent } from "undici";

const ROOT = new URL("..", import.meta.url).pathname;
const RESULTS = join(ROOT, "results");
const ACCESS_LOG = join(RESULTS, "004-status", "access.log");

// 004 専用の入口（nginx/conf.d/004-status.conf）
const EDGE = "http://localhost:8088";
// nginx を挟まない対照（compose.yaml で app を直接開けている）
const APP = "http://localhost:8086";

// ---------------------------------------------------------------- 共通の計測

/** curl を 1 回叩き、status と応答ヘッダを取る */
function probe(url, extraArgs = []) {
  const args = ["-sS", "-i", "-o", "-", "-w", "\\n__STATUS__:%{http_code}\\n", ...extraArgs, url];
  const r = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const out = r.stdout ?? "";
  const status = Number((out.match(/__STATUS__:(\d+)/) ?? [])[1] ?? 0);
  // -i なのでヘッダ + 本文が混ざる。最後の空行で分ける（リダイレクトは使っていない）
  const sep = out.indexOf("\r\n\r\n");
  const headText = sep >= 0 ? out.slice(0, sep) : "";
  const bodyText = sep >= 0 ? out.slice(sep + 4).replace(/\n__STATUS__:\d+\n$/, "") : "";
  const headers = {};
  for (const line of headText.split(/\r?\n/).slice(1)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return { status, headers, bodyText, exitCode: r.status ?? 0, stderr: r.stderr ?? "" };
}

/** コンテナ内の版。stderr に書くコマンドがあるため両方を拾う（規約 3） */
function dockerVersion(service, cmd) {
  const r = spawnSync("docker", ["exec", `http-examples-${service}`, ...cmd], { encoding: "utf8" });
  return `${(r.stdout ?? "").trim()}${(r.stderr ?? "").trim()}`.trim() || "unknown";
}

/** シナリオ開始時刻より後の到着記録だけを読む（再実行の汚染対策） */
function arrivalsSince(startMsec, clientLabel) {
  if (!existsSync(ACCESS_LOG)) return [];
  const rows = [];
  for (const line of readFileSync(ACCESS_LOG, "utf8").split("\n")) {
    const m = line.match(/^(\d+\.\d+)\s/);
    if (!m) continue;
    const t = Number(m[1]);
    if (t < startMsec) continue;
    if (clientLabel && !line.includes(`cl=${clientLabel} `) && !line.endsWith(`cl=${clientLabel}`)) {
      if (!new RegExp(`cl=${clientLabel}(\\s|$)`).test(line)) continue;
    }
    rows.push({ t, line });
  }
  return rows;
}

/**
 * 到着時刻の列から間隔（秒）を出す。
 *
 * 🔴 秒の整数へ丸める。測っているのは「Retry-After の秒数だけ待ったか」であって
 *    ミリ秒の揺れではない。小数で残すと CI の実行速度の差だけで突合が落ちる。
 */
function gaps(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) out.push(Math.round(rows[i].t - rows[i - 1].t));
  return out;
}

/** 3 値の判定（規約 2）。ra は Retry-After の秒数 */
function verdict(arrivalCount, gapList, ra) {
  if (arrivalCount <= 1) return "no_retry";
  const min = Math.min(...gapList);
  // 1 秒の猶予を見る。ra を下回るなら「待っていない」
  return min >= ra - 1 ? "waited" : "immediate";
}

function reset() {
  spawnSync("curl", ["-sS", "-X", "POST", `${EDGE}/004/api/__reset`], { encoding: "utf8" });
}

// ---------------------------------------------------------------- 出力

function emit(id, summary, logLines) {
  const dir = join(RESULTS, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.log"), logLines.join("\n") + "\n");
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`\n[${id}] results/${id}/summary.json と run.log を書きました`);
}

/** CRS の版。イメージのタグは floating なので、規則ファイルの署名から読む */
function crsVersion() {
  const r = spawnSync(
    "docker",
    // 🔴 コメント行にも同じ語が出るため、行頭のディレクティブだけを拾う
    ["exec", "http-examples-waf", "grep", "-m1", "-E", "^SecComponentSignature",
     "/etc/modsecurity.d/owasp-crs/rules/REQUEST-901-INITIALIZATION.conf"],
    { encoding: "utf8" },
  );
  const m = (r.stdout ?? "").match(/OWASP_CRS\/[0-9.]+/);
  return m ? m[0] : "unknown";
}

function header(id, note) {
  // 前段の版は、その前段を使うシナリオでだけ引く（使わないサービスに exec しない）
  const upstream = [];
  if (id === "004-cache-varnish") {
    upstream.push(`varnish: ${dockerVersion("cache", ["varnishd", "-V"]).split("\n")[0]}`);
  }
  if (id === "004-waf") {
    upstream.push(`crs: ${crsVersion()}`, `nginx(waf): ${dockerVersion("waf", ["nginx", "-v"])}`);
  }
  return [
    `# ${id}`,
    `measured-at: ${new Date().toISOString()}`,
    `curl: ${execFileSync("curl", ["--version"], { encoding: "utf8" }).split("\n")[0]}`,
    `node(host): ${process.versions.node}`,
    `undici: ${JSON.parse(readFileSync(join(ROOT, "node_modules/undici/package.json"), "utf8")).version}`,
    `nginx: ${dockerVersion("edge", ["nginx", "-v"])}`,
    `node(app): ${dockerVersion("app", ["node", "-v"])}`,
    ...upstream,
    note ? `note: ${note}` : "",
    "",
  ].filter(Boolean);
}

// ---------------------------------------------------------------- 004-auth-challenge

function scenarioAuthChallenge() {
  const id = "004-auth-challenge";
  const log = header(id, "401 を返した先で何が変わるか。challenge の有無とスキームを振る");

  const arms = [
    ["app_none", `${APP}/004/api/auth/none?cs=auth&cl=curl`],
    ["app_basic", `${APP}/004/api/auth/basic?cs=auth&cl=curl`],
    ["app_bearer", `${APP}/004/api/auth/bearer?cs=auth&cl=curl`],
    ["app_forbidden", `${APP}/004/api/auth/forbidden?cs=auth&cl=curl`],
    ["edge_basic", `${EDGE}/004/api/auth/basic?cs=auth&cl=curl`],
    ["stripped_basic", `${EDGE}/004/stripped/auth/basic?cs=auth&cl=curl`],
    ["nginx_basic", `${EDGE}/004/nginx/basic/index.html?cs=auth&cl=curl`],
    ["nginx_deny", `${EDGE}/004/nginx/deny/index.html?cs=auth&cl=curl`],
  ];

  const summary = {};
  for (const [name, url] of arms) {
    const r = probe(url);
    const wa = r.headers["www-authenticate"] ?? null;
    summary[`status_${name}`] = r.status;
    summary[`challenge_${name}`] = wa;
    log.push(`${name}\t${url}`);
    log.push(`  status=${r.status} www-authenticate=${JSON.stringify(wa)}`);
    log.push(`  content-type=${JSON.stringify(r.headers["content-type"] ?? null)}`);
  }

  // 記事の決定表に効く要約: 401 のうち challenge を持つのは何本か
  const has401 = arms.filter(([n]) => summary[`status_${n}`] === 401);
  summary.arms_total = arms.length;
  summary.arms_401 = has401.length;
  summary.arms_401_with_challenge = has401.filter(([n]) => summary[`challenge_${n}`] !== null).length;

  log.push("", `401 のアーム ${summary.arms_401} 本のうち challenge つきは ${summary.arms_401_with_challenge} 本`);
  emit(id, summary, log);
}

// ---------------------------------------------------------------- 004-retry-after

async function scenarioRetryAfter() {
  const id = "004-retry-after";
  const RA = 3;
  const log = header(id, `429 + Retry-After: ${RA} に従うのは誰か。判定はサーバ側の到着間隔`);

  reset();
  const start = Date.now() / 1000 - 1;

  // ① curl（--retry なし）— 対照。再送しないことを確かめる
  probe(`${EDGE}/004/api/limited?cs=retry&cl=curl-plain&after=0&ra=${RA}`);

  // ② curl --retry 2 — man に「Retry-After: に従う（7.66.0 で追加）」とある
  spawnSync(
    "curl",
    ["-sS", "-o", "/dev/null", "--retry", "2", `${EDGE}/004/api/limited?cs=retry&cl=curl-retry&after=0&ra=${RA}`],
    { encoding: "utf8" },
  );

  // ③ Node の組み込み fetch（undici ベース・再試行の設定なし）
  try {
    await fetch(`${EDGE}/004/api/limited?cs=retry&cl=node-fetch&after=0&ra=${RA}`);
  } catch (e) {
    log.push(`node fetch threw: ${e.message}`);
  }

  // ④ undici の RetryAgent（既定で retryAfter: true・再試行対象に 429 を含む）
  const retryAgent = new RetryAgent(new Agent(), { maxRetries: 2 });
  try {
    const r = await request(`${EDGE}/004/api/limited?cs=retry&cl=undici-retry&after=0&ra=${RA}`, {
      dispatcher: retryAgent,
    });
    await r.body.text();
  } catch (e) {
    log.push(`undici RetryAgent threw after retries: ${e.message}`);
  }

  // 🔴 curl はリポジトリが版を固定できないホストのツール。測った版を値として残す
  //    （GitHub Actions の runner に入っている curl では再送しなかったため・2026-08-20）
  const curlVersion = execFileSync("curl", ["--version"], { encoding: "utf8" }).split("\n")[0].split(" ")[1];
  const summary = { retry_after_seconds: RA, curl_version: curlVersion };
  for (const cl of ["curl-plain", "curl-retry", "node-fetch", "undici-retry"]) {
    const rows = arrivalsSince(start, cl);
    const g = gaps(rows);
    summary[`arrivals_${cl}`] = rows.length;
    summary[`gaps_${cl}`] = g;
    summary[`verdict_${cl}`] = verdict(rows.length, g, RA);
    log.push(`${cl}\t到着 ${rows.length} 回\tgaps=${JSON.stringify(g)}\t判定=${summary[`verdict_${cl}`]}`);
    for (const r of rows) log.push(`  ${r.line}`);
  }
  emit(id, summary, log);
}

// ---------------------------------------------------------------- 004-proxy-intercept

function scenarioProxyIntercept() {
  const id = "004-proxy-intercept";
  const log = header(id, "本文へ書いた詳細（RFC 9457）が、経路の途中で残るか消えるか");

  const direct = probe(`${EDGE}/004/api/problem?cs=intercept&cl=curl`);
  const intercepted = probe(`${EDGE}/004/intercept/problem?cs=intercept&cl=curl`);
  const mismatch = probe(`${EDGE}/004/api/problem?mismatch=1&cs=intercept&cl=curl`);

  const summary = {
    status_direct: direct.status,
    content_type_direct: direct.headers["content-type"] ?? null,
    detail_kept_direct: direct.bodyText.includes("Your current balance is 30"),
    status_intercepted: intercepted.status,
    content_type_intercepted: intercepted.headers["content-type"] ?? null,
    detail_kept_intercepted: intercepted.bodyText.includes("Your current balance is 30"),
    body_replaced_marker: intercepted.bodyText.includes("PROXY-ERROR-PAGE"),
    // RFC 9457 §3.1.2 は status メンバと実際のコードの一致を MUST とする。
    // 食い違わせたとき、汎用ソフト側が見るのはどちらかを記録する
    mismatch_actual_status: mismatch.status,
    mismatch_body_status: (() => {
      try {
        return JSON.parse(mismatch.bodyText).status;
      } catch {
        return null;
      }
    })(),
  };

  log.push(`direct      status=${direct.status} ct=${summary.content_type_direct} detail=${summary.detail_kept_direct}`);
  log.push(`  body: ${direct.bodyText.slice(0, 200)}`);
  log.push(
    `intercepted status=${intercepted.status} ct=${summary.content_type_intercepted} detail=${summary.detail_kept_intercepted}`,
  );
  log.push(`  body: ${intercepted.bodyText.slice(0, 200)}`);
  log.push(`mismatch    actual=${summary.mismatch_actual_status} body.status=${summary.mismatch_body_status}`);
  emit(id, summary, log);
}

// ---------------------------------------------------------------- 004-proxy-cache

function scenarioProxyCache() {
  const id = "004-proxy-cache";
  const log = header(id, "前段のキャッシュはコードを見て保存を変えるか（RFC 6585 §4 は 429 を MUST NOT store）");

  const summary = {};
  for (const code of [200, 404, 429, 503]) {
    // キャッシュ鍵を実行ごとに変え、前回の残りを拾わないようにする
    const nonce = `${Date.now()}${code}`;
    const url = `${EDGE}/004/cached/codes/${code}?n=${nonce}&cs=cache&cl=curl`;
    const first = probe(url);
    const second = probe(url);
    summary[`status_${code}`] = first.status;
    summary[`cache_first_${code}`] = first.headers["x-cache-status"] ?? null;
    summary[`cache_second_${code}`] = second.headers["x-cache-status"] ?? null;
    log.push(`${code}\t1回目=${summary[`cache_first_${code}`]}\t2回目=${summary[`cache_second_${code}`]}`);
  }
  summary.codes_cached = [200, 404, 429, 503].filter((c) => summary[`cache_second_${c}`] === "HIT");
  log.push("", `proxy_cache_valid any で 2 回目が HIT になったコード: ${JSON.stringify(summary.codes_cached)}`);

  // 対照: 保存の可否を上流の Cache-Control に委ねる（proxy_cache_valid を書かない）。
  // 実装が RFC 6585 §4 の MUST NOT を持つなら、429 だけは保存されないはず。
  log.push("", "-- 対照: proxy_cache_valid なし（保存の判断は上流の Cache-Control）--");
  for (const code of [200, 429]) {
    const nonce = `${Date.now()}${code}`;
    const url = `${EDGE}/004/cached-cc/codes/${code}?cc=1&n=${nonce}&cs=cachecc&cl=curl`;
    const first = probe(url);
    const second = probe(url);
    summary[`cc_cache_first_${code}`] = first.headers["x-cache-status"] ?? null;
    summary[`cc_cache_second_${code}`] = second.headers["x-cache-status"] ?? null;
    summary[`cc_header_${code}`] = first.headers["cache-control"] ?? null;
    log.push(
      `${code}\tcache-control=${summary[`cc_header_${code}`]}\t1回目=${summary[`cc_cache_first_${code}`]}\t2回目=${summary[`cc_cache_second_${code}`]}`,
    );
  }
  emit(id, summary, log);
}

// ---------------------------------------------------------------- 004-cache-varnish

// Varnish（別実装のキャッシュ）と nginx を、同じ応答に対して並べる。
// どちらも「保存の可否は応答の Cache-Control に委ねる」条件に揃える。
const CACHE = "http://localhost:8089";
const CACHE_CODES = [200, 201, 400, 401, 403, 404, 410, 418, 422, 429, 451, 500, 502, 503];

function scenarioCacheVarnish() {
  const id = "004-cache-varnish";
  const log = header(id, "同じ応答を nginx と Varnish に通し、保存の判断がコードで変わるかを見る");

  const summary = { codes_tested: CACHE_CODES };
  const varnishHit = [];
  const nginxHit = [];

  for (const code of CACHE_CODES) {
    const nonce = `${Date.now()}${code}`;
    const q = `?cc=1&n=${nonce}&cs=cachecmp&cl=curl`;

    // Varnish（既定 VCL・保存の可否は応答の Cache-Control に委ねる）
    const vUrl = `${CACHE}/004/api/codes/${code}${q}`;
    probe(vUrl);
    const v2 = probe(vUrl);
    const v = v2.headers["x-cache"] ?? null;

    // nginx（proxy_cache_valid を書かない口。同じく Cache-Control に委ねる）
    const nUrl = `${EDGE}/004/cached-cc/codes/${code}${q}`;
    probe(nUrl);
    const n2 = probe(nUrl);
    const n = n2.headers["x-cache-status"] ?? null;

    summary[`varnish_${code}`] = v;
    summary[`nginx_${code}`] = n;
    if (v === "HIT") varnishHit.push(code);
    if (n === "HIT") nginxHit.push(code);
    log.push(`${code}\tvarnish=${v}\tnginx=${n}`);
  }

  summary.varnish_cached_codes = varnishHit;
  summary.nginx_cached_codes = nginxHit;
  summary.varnish_version = dockerVersion("cache", ["varnishd", "-V"]).split("\n")[0];
  log.push("", `varnish が保存したコード: ${JSON.stringify(varnishHit)}`);
  log.push(`nginx が保存したコード: ${JSON.stringify(nginxHit)}`);
  emit(id, summary, log);
}

// ---------------------------------------------------------------- 004-waf

// 同じ状況でサーバ・プロキシ・WAF がそれぞれ何を返すか、のうち WAF 側。
// 問いは「403 が返ったとき、それはアプリの認可判断か WAF の遮断か」。
const WAF = "http://localhost:8090";

function scenarioWaf() {
  const id = "004-waf";
  const log = header(id, "WAF の 403 と、アプリの 403 をクライアントから見分けられるか");

  // ① アプリが返す 403（認可の判断）
  const appForbidden = probe(`${WAF}/004/api/auth/forbidden?cs=waf&cl=curl`);
  // ② WAF が遮断して返す 403（要求そのものを拒否）
  const wafBlocked = probe(`${WAF}/004/api/codes/200?cs=waf&cl=curl&q=${encodeURIComponent("1' OR '1'='1")}`);
  // ③ 素通しの対照
  const passthrough = probe(`${WAF}/004/api/codes/200?cs=waf&cl=curl`);
  // ④ WAF を越えたとき 401 の challenge は残るか
  const basicVia = probe(`${WAF}/004/api/auth/basic?cs=waf&cl=curl`);
  // ⑤ WAF を越えたとき Retry-After は残るか
  const limitedVia = probe(`${WAF}/004/api/codes/429?cs=waf&cl=curl`);
  // ⑥ WAF を越えたとき Problem Details の本文は残るか
  const problemVia = probe(`${WAF}/004/api/problem?cs=waf&cl=curl`);

  const summary = {
    status_passthrough: passthrough.status,
    status_app_forbidden: appForbidden.status,
    content_type_app_forbidden: appForbidden.headers["content-type"] ?? null,
    status_waf_blocked: wafBlocked.status,
    content_type_waf_blocked: wafBlocked.headers["content-type"] ?? null,
    // 🔴 クライアントから見て同じコードか
    same_status_app_and_waf: appForbidden.status === wafBlocked.status,
    // 本文で見分けられるか（アプリ側は自分が書いた JSON を返す）
    app_body_has_own_marker: appForbidden.bodyText.includes("forbidden"),
    waf_body_has_own_marker: !wafBlocked.bodyText.includes("forbidden"),
    // 🔴 対照: 401 は書き換わらない。書き換えはコードで絞られている
    content_type_401_through_waf: basicVia.headers["content-type"] ?? null,
    cors_added_on_403: wafBlocked.headers["access-control-allow-origin"] ?? null,
    cors_added_on_401: basicVia.headers["access-control-allow-origin"] ?? null,
    challenge_through_waf: basicVia.headers["www-authenticate"] ?? null,
    retry_after_through_waf: limitedVia.headers["retry-after"] ?? null,
    problem_detail_through_waf: problemVia.bodyText.includes("Your current balance is 30"),
  };

  log.push(`素通し           status=${passthrough.status}`);
  log.push(`アプリの 403     status=${appForbidden.status} ct=${summary.content_type_app_forbidden}`);
  log.push(`  body: ${appForbidden.bodyText.slice(0, 160)}`);
  log.push(`WAF の 403       status=${wafBlocked.status} ct=${summary.content_type_waf_blocked}`);
  log.push(`  body: ${wafBlocked.bodyText.slice(0, 160)}`);
  log.push(`WAF 越しの challenge     = ${JSON.stringify(summary.challenge_through_waf)}`);
  log.push(`WAF 越しの Retry-After   = ${JSON.stringify(summary.retry_after_through_waf)}`);
  log.push(`WAF 越しの Problem 本文  = ${summary.problem_detail_through_waf}`);
  emit(id, summary, log);
}


// ---------------------------------------------------------------- 004-auth-oauth-error

// 「403 には challenge が付かない」は一般則ではない、を測る。
// RFC 6750 §3 は、アクセスを許さないトークンで来た要求にも WWW-Authenticate を MUST
// とし、§3.1 は invalid_token に 401 を、insufficient_scope に 403 を SHOULD とする。
// 004-auth-challenge の 8 アームは「challenge を持たない 403」の側だけを測っていた。
// ここは対になる側を測り、あわせて前段（nginx / WAF）を越えて残るかを見る。
function scenarioAuthOauthError() {
  const id = "004-auth-oauth-error";
  const log = header(id, "Bearer の 401 / 403 が challenge に載せるものと、前段を越えて残るか");

  const arms = [
    ["app_401_invalid_token", `${APP}/004/api/oauth/invalid-token?cs=oauth&cl=curl`],
    ["app_403_insufficient_scope", `${APP}/004/api/oauth/insufficient-scope?cs=oauth&cl=curl`],
    // 対照: challenge を持たない素の 403（004-auth-challenge の app_forbidden と同じ口）
    ["app_403_plain", `${APP}/004/api/auth/forbidden?cs=oauth&cl=curl`],
    // 前段を越えて残るか
    ["edge_403_insufficient_scope", `${EDGE}/004/api/oauth/insufficient-scope?cs=oauth&cl=curl`],
    ["waf_403_insufficient_scope", `${WAF}/004/api/oauth/insufficient-scope?cs=oauth&cl=curl`],
    // 剥がす経路を通したらどうなるか（proxy_hide_header WWW-Authenticate）
    ["stripped_403_insufficient_scope", `${EDGE}/004/stripped/oauth/insufficient-scope?cs=oauth&cl=curl`],
  ];

  const summary = {};
  for (const [name, url] of arms) {
    const r = probe(url);
    summary[`status_${name}`] = r.status;
    summary[`challenge_${name}`] = r.headers["www-authenticate"] ?? null;
    summary[`content_type_${name}`] = r.headers["content-type"] ?? null;
    log.push(`${name}\t${url}`);
    log.push(`  status=${r.status} www-authenticate=${JSON.stringify(r.headers["www-authenticate"] ?? null)}`);
    log.push(`  content-type=${JSON.stringify(r.headers["content-type"] ?? null)}`);
    log.push(`  body: ${r.bodyText.slice(0, 200)}`);
  }

  // 記事に効く要約: 403 を返したアームのうち challenge を持つのは何本か
  const arms403 = arms.filter(([n]) => summary[`status_${n}`] === 403);
  summary.arms_total = arms.length;
  summary.arms_403 = arms403.length;
  summary.arms_403_with_challenge = arms403.filter(([n]) => summary[`challenge_${n}`] !== null).length;

  log.push("", `403 のアーム ${summary.arms_403} 本のうち challenge つきは ${summary.arms_403_with_challenge} 本`);
  emit(id, summary, log);
}

// ---------------------------------------------------------------- 004-retry-undici

// 🔴 004-retry-after のうち、**リポジトリが版を固定できる分**だけを CI に載せる。
//    curl はホストのツールで版が環境ごとに違い、実際 GitHub Actions の runner では
//    再送しなかった（2026-08-20 の CI で検出）。固定できない値を CI の突合に載せると、
//    陳腐化の検知ではなく環境差の検知になってしまう。
//    Node と undici は package-lock.json が固定するため、ここは CI で回す。
async function scenarioRetryUndici() {
  const id = "004-retry-undici";
  const RA = 3;
  const log = header(id, `429 + Retry-After: ${RA}。package-lock.json が版を固定する 2 経路のみ`);

  reset();
  const start = Date.now() / 1000 - 1;

  try {
    await fetch(`${EDGE}/004/api/limited?cs=retryu&cl=u-node-fetch&after=0&ra=${RA}`);
  } catch (e) {
    log.push(`node fetch threw: ${e.message}`);
  }

  const retryAgent = new RetryAgent(new Agent(), { maxRetries: 2 });
  try {
    const r = await request(`${EDGE}/004/api/limited?cs=retryu&cl=u-undici-retry&after=0&ra=${RA}`, {
      dispatcher: retryAgent,
    });
    await r.body.text();
  } catch (e) {
    log.push(`undici RetryAgent threw after retries: ${e.message}`);
  }

  const summary = {
    retry_after_seconds: RA,
    undici_version: JSON.parse(readFileSync(join(ROOT, "node_modules/undici/package.json"), "utf8")).version,
  };
  for (const cl of ["u-node-fetch", "u-undici-retry"]) {
    const rows = arrivalsSince(start, cl);
    const g = gaps(rows);
    summary[`arrivals_${cl}`] = rows.length;
    summary[`gaps_${cl}`] = g;
    summary[`verdict_${cl}`] = verdict(rows.length, g, RA);
    log.push(`${cl}\t到着 ${rows.length} 回\tgaps=${JSON.stringify(g)}\t判定=${summary[`verdict_${cl}`]}`);
    for (const r of rows) log.push(`  ${r.line}`);
  }
  emit(id, summary, log);
}

// ---------------------------------------------------------------- entry

const SCENARIOS = {
  "004-auth-challenge": scenarioAuthChallenge,
  "004-retry-after": scenarioRetryAfter,
  "004-proxy-intercept": scenarioProxyIntercept,
  "004-proxy-cache": scenarioProxyCache,
  "004-cache-varnish": scenarioCacheVarnish,
  "004-waf": scenarioWaf,
  "004-retry-undici": scenarioRetryUndici,
  "004-auth-oauth-error": scenarioAuthOauthError,
};

const arg = process.argv.slice(2).find((a) => a.startsWith("--scenario="));
const id = arg?.slice("--scenario=".length);
if (!id || !(id in SCENARIOS)) {
  console.error(`使い方: node tools/measure-004.mjs --scenario=<${Object.keys(SCENARIOS).join("|")}>`);
  process.exit(3);
}
await SCENARIOS[id]();
