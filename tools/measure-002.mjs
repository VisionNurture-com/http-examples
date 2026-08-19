#!/usr/bin/env node
// measure-002.mjs — 記事 002（リクエストを最小で再現する）の測定
//
// 使い方:
//   node tools/measure-002.mjs --scenario=002-minimize
//
// 🔴 判定は 4 点比較で行う。
//    応答コードだけを見ると「200 のまま中身が変わる」型を取りこぼす。
//
//      ① status  ② レスポンスヘッダの集合  ③ body の SHA-256  ④ body のバイト数
//
//    ② から Date は外す。毎秒動くため、外さないと全ケースが「変わった」になる。
//
// 🔴 分類は 3 つ（記事の決定表と同じ）。
//      A 壊れる       … status が変わった
//      B 壊れないが変わる … status は同じで ②〜④ のどれかが変わった
//      C 変わらない    … 4 点とも同じ
//
// 前提: docker compose up -d --wait

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync, brotliDecompressSync, inflateSync } from "node:zlib";
import { connect } from "node:net";

const ROOT = new URL("..", import.meta.url).pathname;
const RESULTS = join(ROOT, "results");

// 002 専用の入口（nginx/conf.d/002-minimal.conf）
const EDGE = "http://localhost:8087";
// nginx を挟まない対照（compose.yaml で app を直接開けている）
const APP = "http://localhost:8086";
// h2 を話す口。000-base.conf の `listen 443 ssl; http2 on;`
const EDGE_H2 = "https://localhost:8443";

// ---------------------------------------------------------------- 共通の計測

/** レスポンスヘッダのうち、実行のたびに動くもの。②の集合から外す */
const VOLATILE = new Set(["date"]);

/**
 * curl を 1 回叩いて 4 点を取る。
 * curl 自身が送信前に弾いた場合（exit≠0）も、それが分かる形で返す（D4）。
 */
function probe({ url, method = "GET", headers = {}, dropHeaders = [], body = null, curlArgs = [] }) {
  const tmp = join(tmpdir(), `m002-${process.pid}-${Math.floor(performance.now() * 1000)}`);
  const bodyFile = `${tmp}.body`;
  const hdrFile = `${tmp}.hdr`;
  const bodyIn = body === null ? null : `${tmp}.in`;
  if (bodyIn) writeFileSync(bodyIn, body);

  const args = [
    "-sS",
    "--http1.1",
    "-X",
    method,
    "-o",
    bodyFile,
    "-D",
    hdrFile,
    "-w",
    "%{http_code}",
    ...curlArgs,
    ...headerArgs(headers, dropHeaders),
  ];
  if (bodyIn) args.push("--data-binary", `@${bodyIn}`);
  args.push(url);

  let status = 0;
  let curlExit = 0;
  let stderr = "";
  try {
    const out = execFileSync("curl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    status = Number(out.trim() || 0);
  } catch (e) {
    curlExit = e.status ?? -1;
    stderr = String(e.stderr ?? "").trim();
  }

  const rawBody = existsSync(bodyFile) ? readFileSync(bodyFile) : Buffer.alloc(0);
  const rawHdr = existsSync(hdrFile) ? readFileSync(hdrFile, "utf8") : "";
  for (const f of [bodyFile, hdrFile, bodyIn]) if (f && existsSync(f)) rmSync(f);

  const responseHeaders = parseHeaders(rawHdr);

  // 🔴 curl が非 0 で終了しても、応答を受け取っていれば -D のヘッダに状態行が残る。
  //    サーバが送信の途中で応答して接続を閉じると、送信側が書き込みエラーになることがある
  //    （002-header-size の「1000B × 32 本」で CI が踏んだ。ローカルでは再現しない環境差）。
  //    ここで回収しないと status=0 として記録され、expected.md との突合が
  //    「値の乖離」に見えてしまう——実際には応答は返っており、測れなかったのは手元の道具の側。
  //    1xx（100 Continue / 103 Early Hints）は最終応答ではないため除いて最後の状態行を採る。
  if (status === 0 && rawHdr) {
    const codes = [...rawHdr.matchAll(/^HTTP\/[\d.]+ (\d{3})/gm)]
      .map((m) => Number(m[1]))
      .filter((c) => c >= 200);
    if (codes.length) status = codes[codes.length - 1];
  }

  return {
    status,
    curlExit,
    stderr,
    responseHeaders,
    // 🔴 ③④ はワイヤに出たバイトで測る。圧縮の有無そのものが観測対象のため、
    //    ここで復号した値を使うと「Accept-Encoding を削っても変わらない」になる。
    bodyBytes: rawBody.length,
    bodySha256: createHash("sha256").update(rawBody).digest("hex"),
    // JSON を読む用途にだけ復号したテキストを渡す。復号を忘れると echo が
    // パースできず、全ケースが「変わった」に倒れる（実際に一度そうなった）。
    bodyText: decodeBody(rawBody, responseHeaders).toString("utf8"),
  };
}

function decodeBody(buf, headers) {
  const ce = (headers["content-encoding"] ?? "").toLowerCase();
  try {
    if (ce === "gzip") return gunzipSync(buf);
    if (ce === "br") return brotliDecompressSync(buf);
    if (ce === "deflate") return inflateSync(buf);
  } catch {
    /* 復号できなければ生のまま返す（判定は 4 点比較が担う） */
  }
  return buf;
}

/** `-D` が書いたヘッダ列を小文字キーの dict にする（最終応答のみ採る） */
function parseHeaders(raw) {
  const blocks = raw.split(/\r?\n\r?\n/).filter((b) => b.trim());
  const last = blocks[blocks.length - 1] ?? "";
  const out = {};
  for (const line of last.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/** すべての情報応答（1xx）を含む生のステータス行を拾う。100-continue / 101 の観測用 */
function statusLines(raw) {
  return raw.split(/\r?\n/).filter((l) => /^HTTP\//.test(l)).map((l) => l.trim());
}

/**
 * curl の -H 引数を組み立てる。
 * curl は既定で User-Agent / Accept を足すため、指定集合に無いものは明示的に消す。
 */
function headerArgs(headers, drop = []) {
  const dropSet = new Set(drop.map((n) => n.toLowerCase()));
  const args = [];
  const present = new Set();
  for (const [k, v] of Object.entries(headers)) {
    if (dropSet.has(k.toLowerCase())) continue;
    args.push("-H", `${k}: ${v}`);
    present.add(k.toLowerCase());
  }
  for (const def of ["User-Agent", "Accept"]) {
    if (!present.has(def.toLowerCase())) args.push("-H", `${def}:`);
  }
  // 削除指定は curl が自前で足すヘッダ（Host / Content-Length 等）にも効かせる。
  // 値なしの `-H "Name:"` が curl の「このヘッダを送るな」の書式。
  for (const d of drop) args.push("-H", `${d}:`);
  return args;
}

/**
 * 4 点を取り出す。②は Date を除いた「名前: 値」の並び。
 *
 * 🔴 echo を相手にする通しでは content-length / etag も外す。echo は受け取ったヘッダを
 *    そのまま返すため、1 本削れば応答の長さが必ず動く。外さないと全ケースが「変わった」に
 *    倒れ、分類が成立しない（実際に一度そうなった）。外す代わりに、サーバが要求をどう
 *    扱ったか（method / 届いたバイト数 / そのハッシュ）を project で取り出して比較する。
 */
function fourPoint(r, project, extraVolatile = []) {
  const skip = new Set([...VOLATILE, ...extraVolatile]);
  const hs = Object.entries(r.responseHeaders)
    .filter(([k]) => !skip.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`);
  const body = project ? project(r) : { sha: r.bodySha256, bytes: r.bodyBytes };
  return { status: r.status, headerSet: hs, bodySha256: body.sha, bodyBytes: body.bytes };
}

/** echo が返す長さは要求の写しなので、比較から外す応答ヘッダ */
const ECHO_VOLATILE = ["content-length", "etag"];

function classify(base, cur) {
  if (base.status !== cur.status) return "A";
  const same =
    JSON.stringify(base.headerSet) === JSON.stringify(cur.headerSet) &&
    base.bodySha256 === cur.bodySha256 &&
    base.bodyBytes === cur.bodyBytes;
  return same ? "C" : "B";
}

/**
 * echo は受け取ったヘッダをそのまま返すため、body がいつも変わる。
 * 「サーバが要求をどう扱ったか」だけを取り出して比較する（ヘッダの echo は外す）。
 */
function echoProjection(r) {
  try {
    const j = JSON.parse(r.bodyText);
    const projected = JSON.stringify({ method: j.method, bodyBytes: j.bodyBytes, bodySha256: j.bodySha256 });
    return { sha: createHash("sha256").update(projected).digest("hex"), bytes: j.bodyBytes };
  } catch {
    return { sha: r.bodySha256, bytes: r.bodyBytes };
  }
}

// ---------------------------------------------------------------- 出力

function emit(id, summary, logLines) {
  const dir = join(RESULTS, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.log"), logLines.join("\n") + "\n");
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`\n[${id}] results/${id}/summary.json と run.log を書きました`);
}

function header(id, note) {
  return [
    `# ${id}`,
    `measured-at: ${new Date().toISOString()}`,
    `curl: ${execFileSync("curl", ["--version"], { encoding: "utf8" }).split("\n")[0]}`,
    `nginx: ${dockerVersion("edge", ["nginx", "-v"])}`,
    `node(app): ${dockerVersion("app", ["node", "-v"])}`,
    note ? `note: ${note}` : "",
    "",
  ].filter(Boolean);
}

function dockerVersion(service, cmd) {
  // 🔴 nginx -v は stderr に書く。stdout だけを拾うと空文字が記録され、
  //    「版を測った」つもりの空欄が生ログに残る（実際に一度そうなった）。
  try {
    const out = execFileSync("docker", ["compose", "exec", "-T", service, "sh", "-c", `${cmd.join(" ")} 2>&1`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return out.split("\n").filter(Boolean).pop() ?? "(空)";
  } catch (e) {
    return `(取得失敗: ${String(e.message).split("\n")[0]})`;
  }
}

// ---------------------------------------------------------------- 通しの定義

/** 4 通し。経路（nginx 単独 / nginx→Express）と本文の種類（静的 GET / JSON POST）を
 *  組み合わせ、「どちらが弾いたか」を分けられるようにする。 */
const PASSES = [
  { key: "static-nginx", label: "静的 GET × nginx 単独", url: `${EDGE}/002/static/sample.html`, method: "GET" },
  { key: "static-app", label: "静的 GET × nginx→Express", url: `${EDGE}/002/api/static`, method: "GET" },
  { key: "json-nginx", label: "JSON POST × nginx 単独", url: `${EDGE}/002/static/sample.html`, method: "POST", json: true },
  { key: "json-app", label: "JSON POST × nginx→Express", url: `${EDGE}/002/api/echo`, method: "POST", json: true, project: echoProjection, volatile: ECHO_VOLATILE },
];

const JSON_BODY = JSON.stringify({ item: "sample", qty: 2 });

// ---------------------------------------------------------------- 002-minimize

function runMinimize() {
  const id = "002-minimize";
  const capturePath = join(RESULTS, id, "browser.chromium.json");
  const browsersPath = join(RESULTS, id, "browsers.json");
  if (!existsSync(capturePath) || !existsSync(browsersPath)) {
    console.error(`✗ ${capturePath} がありません。先に node tools/capture-002-browser.mjs を実行してください`);
    process.exit(1);
  }
  const captured = JSON.parse(readFileSync(capturePath, "utf8"));
  const browsers = JSON.parse(readFileSync(browsersPath, "utf8"));
  const baseHeaders = captured.headers;
  const names = Object.keys(baseHeaders);

  const log = header(id, "ブラウザが送ったヘッダ集合を curl で再現し、1 本ずつ削って 4 点比較する");
  log.push(`ブラウザが送ったヘッダ: ${names.length} 本`, `  ${names.join(", ")}`, "");

  const perPass = {};
  for (const pass of PASSES) {
    const body = pass.json ? JSON_BODY : null;
    const hdrs = pass.json ? { ...baseHeaders, "Content-Type": "application/json" } : { ...baseHeaders };
    const base = fourPoint(probe({ url: pass.url, method: pass.method, headers: hdrs, body }), pass.project, pass.volatile);
    log.push(`## ${pass.label}`, `baseline: status=${base.status} bytes=${base.bodyBytes}`);

    const cls = { A: [], B: [], C: [] };
    for (const n of Object.keys(hdrs)) {
      const r = probe({ url: pass.url, method: pass.method, headers: hdrs, dropHeaders: [n], body });
      const cur = fourPoint(r, pass.project, pass.volatile);
      const c = classify(base, cur);
      cls[c].push(n);
      log.push(
        `  - ${n.padEnd(24)} ${c}  status=${cur.status} wire=${r.bodyBytes}B` +
          (r.curlExit ? ` curl-exit=${r.curlExit}` : "")
      );
    }

    // 分類 C を全部まとめて落としても baseline と同じかを確認する（= 最小集合の検算）
    const minimal = [...cls.A, ...cls.B];
    const stripped = fourPoint(probe({ url: pass.url, method: pass.method, headers: hdrs, dropHeaders: cls.C, body }), pass.project, pass.volatile);
    const minimalHolds = classify(base, stripped) === "C";
    log.push(
      `  → 壊れる ${cls.A.length} / 変わる ${cls.B.length} / 変わらない ${cls.C.length}`,
      `  → C を全部落としても baseline と同じか: ${minimalHolds ? "はい" : "いいえ"}`,
      ""
    );

    perPass[pass.key] = {
      breaks: cls.A.sort(),
      changes: cls.B.sort(),
      no_effect_count: cls.C.length,
      minimal_header_count: minimal.length,
      minimal_set_verified: minimalHolds,
      baseline_status: base.status,
    };
  }

  const summary = {
    browsers,
    browser_header_count: names.length,
    passes: perPass,
  };
  emit(id, summary, log);
}

// ---------------------------------------------------------------- 単発シナリオ

function runHost() {
  const id = "002-host";
  const log = header(id, "Host を削ると誰が弾くか（RFC 9112 §3.2 は HTTP/1.1 で必須と定める）");
  const cases = [
    { name: "nginx 単独（静的）", url: `${EDGE}/002/static/sample.html` },
    { name: "nginx→Express", url: `${EDGE}/002/api/echo` },
    { name: "Express 直結", url: `${APP}/002/api/echo` },
  ];
  const out = {};
  for (const c of cases) {
    const withHost = probe({ url: c.url });
    const without = probe({ url: c.url, dropHeaders: ["Host"] });
    log.push(`## ${c.name}`, `  Host あり: status=${withHost.status}`, `  Host なし: status=${without.status} curl-exit=${without.curlExit}`);
    if (without.stderr) log.push(`  stderr: ${without.stderr}`);
    out[c.name] = { with_host: withHost.status, without_host: without.status, curl_refused: without.curlExit !== 0 };
  }
  log.push("");
  emit(id, {
    status_without_host_nginx_static: out["nginx 単独（静的）"].without_host,
    status_without_host_via_nginx: out["nginx→Express"].without_host,
    status_without_host_app_direct: out["Express 直結"].without_host,
    curl_refused_to_send: Object.values(out).every((o) => o.curl_refused),
  }, log);
}

function runExpect() {
  const id = "002-expect";
  const log = header(id, "自分では書いていない Expect: 100-continue を curl が足す条件と、上限の違う 2 つの口での返り方");
  // 1 MiB の前後を挟む。curl のしきい値はこの近辺にある
  const sizes = [1024, 1048576, 1048577, 2097152];
  const targets = [
    { key: "default_limit", label: "既定の上限（client_max_body_size 未指定 = 1m）", url: `${EDGE}/002/api/echo` },
    { key: "raised_limit", label: "上限を 8m にした口", url: `${EDGE}/002/large/echo` },
  ];
  const rows = {};
  let threshold = null;

  for (const t of targets) {
    log.push(`## ${t.label}`);
    for (const n of sizes) {
      const tmp = join(tmpdir(), `m002-expect-${n}`);
      writeFileSync(tmp, "x".repeat(n));
      // 送信ヘッダ（> 行）と情報応答（< HTTP/1.1 100）は -v のトレースにしか出ない
      const trace = curlTrace(["-X", "POST", "-H", "Content-Type: application/octet-stream", "--data-binary", `@${tmp}`], t.url);
      rmSync(tmp);
      const autoSent = /^> Expect: 100-continue/m.test(trace);
      const got100 = /^< HTTP\/1\.1 100/m.test(trace);
      const finalStatus = Number((trace.match(/^< HTTP\/1\.1 (\d{3})(?! Continue)/gm) ?? []).map((l) => l.match(/(\d{3})/)[1]).filter((c) => c !== "100").pop() ?? 0);
      rows[`${t.key}:${n}`] = { expect_sent_by_curl: autoSent, server_sent_100: got100, final_status: finalStatus };
      if (t.key === "default_limit" && autoSent && threshold === null) threshold = n;
      log.push(
        `  body=${String(n).padStart(8)} バイト  curl が Expect を付けた: ${autoSent ? "はい" : "いいえ"}` +
          `  100 Continue: ${got100 ? "あり" : "なし"}  最終 status=${finalStatus}`
      );
    }
    log.push("");
  }

  emit(id, {
    sizes_tested: sizes,
    expect_auto_threshold_bytes: threshold,
    default_limit_status_at_2mb: rows["default_limit:2097152"].final_status,
    raised_limit_status_at_2mb: rows["raised_limit:2097152"].final_status,
    raised_limit_sent_100_at_2mb: rows["raised_limit:2097152"].server_sent_100,
    default_limit_sent_100_at_2mb: rows["default_limit:2097152"].server_sent_100,
    per_case: rows,
  }, log);
}

/**
 * -v の全トレース（送信ヘッダ `>` と情報応答 `<` を含む）を得る。
 *
 * 🔴 -v は stderr に書く。execFileSync の戻り値は stdout だけなので、成功時に
 *    トレースが空になり「Content-Length を送っていない」という誤った実測が出る
 *    （実際に一度そうなった）。spawnSync で両方を必ず拾う。
 */
function curlTrace(extra, url) {
  const r = spawnSync("curl", ["-sS", "-v", "--http1.1", "-o", "/dev/null", ...extra, url], {
    encoding: "utf8",
  });
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
}

function runLength() {
  const id = "002-length";
  const log = header(id, "Content-Length を消すと curl は何に切り替えるか / サーバは受けるか");
  const tmp = join(tmpdir(), "m002-length.json");
  writeFileSync(tmp, JSON_BODY);
  const normal = curlTrace(["-X", "POST", "-H", "Content-Type: application/json", "--data-binary", `@${tmp}`], `${EDGE}/002/api/echo`);
  const dropped = curlTrace(["-X", "POST", "-H", "Content-Type: application/json", "-H", "Content-Length:", "--data-binary", `@${tmp}`], `${EDGE}/002/api/echo`);
  const chunked = curlTrace(["-X", "POST", "-H", "Content-Type: application/json", "-H", "Transfer-Encoding: chunked", "--data-binary", `@${tmp}`], `${EDGE}/002/api/echo`);
  rmSync(tmp);

  const arrived = (t) => {
    const m = t.match(/"bodyBytes":\s*(\d+)/);
    return m ? Number(m[1]) : null;
  };
  function probeWithBody(opts) {
    return probe({
      url: `${EDGE}/002/api/echo`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      dropHeaders: opts.drop ?? [],
      body: JSON_BODY,
      curlArgs: opts.args ?? [],
    });
  }

  const rNormal = probeWithBody({});
  const rDropped = probeWithBody({ drop: ["Content-Length"] });
  const rChunked = probeWithBody({ args: ["-H", "Transfer-Encoding: chunked"] });

  const declaredNormal = /^> Content-Length:/m.test(normal);
  const declaredDropped = /^> Content-Length:/m.test(dropped);
  const usedChunked = /^> Transfer-Encoding: chunked/m.test(dropped) || /^> Transfer-Encoding: chunked/m.test(chunked);

  log.push(
    `  既定           : Content-Length を送った=${declaredNormal} / status=${rNormal.status} / 届いたバイト=${arrived(rNormal.bodyText)}`,
    `  Content-Length 削除: Content-Length を送った=${declaredDropped} / status=${rDropped.status} / 届いたバイト=${arrived(rDropped.bodyText)}`,
    `  chunked 明示   : status=${rChunked.status} / 届いたバイト=${arrived(rChunked.bodyText)}`,
    ""
  );

  emit(id, {
    body_bytes_sent: JSON_BODY.length,
    status_default: rNormal.status,
    status_without_content_length: rDropped.status,
    status_with_chunked: rChunked.status,
    arrived_bytes_default: arrived(rNormal.bodyText),
    arrived_bytes_without_content_length: arrived(rDropped.bodyText),
    arrived_bytes_with_chunked: arrived(rChunked.bodyText),
    curl_switched_to_chunked: usedChunked,
  }, log);
}

function runConnH2() {
  const id = "002-conn-h2";
  const log = header(id, "h1 用にコピーしたヘッダを h2 で送る（RFC 9113 §8.2.2 は接続固有ヘッダを malformed と定める）");
  const connHeaders = ["Connection: keep-alive", "Keep-Alive: timeout=5", "Upgrade: websocket", "Transfer-Encoding: chunked"];
  const rows = {};
  for (const h of connHeaders) {
    const name = h.split(":")[0];
    const trace = curlTrace(["--http2", "-k", "-H", h], `${EDGE_H2}/002/api/echo`);
    // 🔴 `> Name:` 行は curl の論理表示で、ワイヤに出たかを表さない。
    //    実際に HEADERS フレームへ入ったものは `* [HTTP/2] [1] [name: value]` 行にだけ出る。
    //    ここを取り違えると「curl が落とした」を「サーバが受け入れた」と読み違える（実際に一度そうなった）。
    const frame = [...trace.matchAll(/^\* \[HTTP\/2\] \[\d+\] \[([^:\]]+): /gm)].map((m) => m[1].toLowerCase());
    const sentOnWire = frame.includes(name.toLowerCase());
    const status = (trace.match(/^< HTTP\/2 (\d+)/m) ?? [])[1] ?? null;
    const curlDropped = !sentOnWire;
    rows[name] = { sent_in_h2_frame: sentOnWire, status: status ? Number(status) : null, dropped_by_curl: curlDropped };
    log.push(
      `  ${name.padEnd(18)} h2 フレームに入った=${sentOnWire}  status=${status ?? "-"}  → ${curlDropped ? "curl が送信前に落とした" : "サーバまで届いた"}`
    );
  }
  log.push(`  （参考）フレームに実際に入った名前: ${JSON.stringify([...new Set([...curlTrace(["--http2", "-k"], `${EDGE_H2}/002/api/echo`).matchAll(/^\* \[HTTP\/2\] \[\d+\] \[([^:\]]+): /gm)].map((m) => m[1]))])}`);
  // 対照: 同じヘッダを h1 で送ると通るか
  const h1 = probe({ url: `${EDGE}/002/api/echo`, headers: { Connection: "keep-alive" } });
  log.push(`  （対照）h1 で Connection: keep-alive → status=${h1.status}`, "");

  emit(id, {
    connection_specific_headers_tested: connHeaders.map((h) => h.split(":")[0]),
    dropped_by_curl_before_send: Object.entries(rows).filter(([, v]) => v.dropped_by_curl).map(([k]) => k).sort(),
    reached_server: Object.entries(rows).filter(([, v]) => v.sent_in_h2_frame).map(([k]) => k).sort(),
    h1_control_status: h1.status,
    per_header: rows,
  }, log);
}

function runAcceptEncoding() {
  const id = "002-accept-encoding";
  const log = header(id, "🔴 nginx の既定は gzip off。002-minimal.conf で on にしたうえでの結果");
  const targets = [
    { key: "nginx_static", url: `${EDGE}/002/static/sample.html` },
    { key: "via_nginx_app", url: `${EDGE}/002/api/static` },
  ];
  const out = {};
  for (const t of targets) {
    const withAE = probe({ url: t.url, headers: { "Accept-Encoding": "gzip" } });
    const without = probe({ url: t.url, dropHeaders: ["Accept-Encoding"] });
    out[t.key] = {
      status_with: withAE.status,
      status_without: without.status,
      bytes_with: withAE.bodyBytes,
      bytes_without: without.bodyBytes,
      content_encoding_with: withAE.responseHeaders["content-encoding"] ?? null,
      content_encoding_without: without.responseHeaders["content-encoding"] ?? null,
      vary: withAE.responseHeaders["vary"] ?? null,
    };
    log.push(
      `## ${t.key}`,
      `  Accept-Encoding: gzip → status=${withAE.status} bytes=${withAE.bodyBytes} Content-Encoding=${out[t.key].content_encoding_with}`,
      `  削除              → status=${without.status} bytes=${without.bodyBytes} Content-Encoding=${out[t.key].content_encoding_without}`,
      `  Vary=${out[t.key].vary}`,
      ""
    );
  }
  emit(id, {
    nginx_default_is_gzip_off: true,
    bytes_gzip_nginx_static: out.nginx_static.bytes_with,
    bytes_plain_nginx_static: out.nginx_static.bytes_without,
    status_unchanged: out.nginx_static.status_with === out.nginx_static.status_without,
    vary_present: out.nginx_static.vary !== null,
    per_target: out,
  }, log);
}

/**
 * 生ソケットで組み立てたリクエストを送る。
 *
 * 🔴 curl は Host を重複させてくれない（2 本書いても 1 本に畳む）。RFC 9112 §3.2 が
 *    「複数の Host を受け取ったサーバは 400 を返さなければならない」と定めているかを
 *    測るには、バイト列を自分で組む以外にない。curl で測ったつもりになると、
 *    「重複しても 200 だった」という誤った実測が出る（実際に一度そうなった）。
 */
function rawRequest(lines, { host = "localhost", port = 8087 } = {}) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    let buf = Buffer.alloc(0);
    const finish = () => {
      const text = buf.toString("utf8");
      const status = Number((text.match(/^HTTP\/1\.[01] (\d{3})/) ?? [])[1] ?? 0);
      const body = text.split(/\r\n\r\n/).slice(1).join("\r\n\r\n");
      sock.destroy();
      resolve({ status, text, body });
    };
    sock.setTimeout(5000);
    sock.on("connect", () => sock.write(lines.join("\r\n") + "\r\n\r\n"));
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
    });
    sock.on("end", finish);
    sock.on("timeout", finish);
    sock.on("error", () => resolve({ status: 0, text: "", body: "" }));
  });
}

async function runDuplicateOrder() {
  const id = "002-duplicate-order";
  const log = header(id, "同名ヘッダの重複と、並びの入れ替えが結果を変えるか（生ソケットで組む）");

  const req = (extra) => ["GET /002/api/echo HTTP/1.1", "Host: localhost", ...extra, "Connection: close"];

  const base = await rawRequest(req(["X-Sample: one", "Accept-Language: ja"]));
  const swapped = await rawRequest(req(["Accept-Language: ja", "X-Sample: one"]));
  const dup = await rawRequest(req(["X-Sample: one", "X-Sample: two"]));
  // Host を 2 本。1 本目は上の req() が入れているので、もう 1 本足す
  const dupHost = await rawRequest([
    "GET /002/api/echo HTTP/1.1",
    "Host: localhost",
    "Host: other",
    "Connection: close",
  ]);

  const parse = (r) => {
    try {
      return JSON.parse(r.body);
    } catch {
      return null;
    }
  };
  const echoed = (r, name) => parse(r)?.headers?.[name] ?? null;
  const orderOf = (r) => parse(r)?.rawHeaderOrder ?? [];

  log.push(
    `  並び替え      : status ${base.status} → ${swapped.status}`,
    `    受信順 ${JSON.stringify(orderOf(base))}`,
    `        → ${JSON.stringify(orderOf(swapped))}`,
    `  重複(X-Sample): status=${dup.status} / サーバが見た値=${JSON.stringify(echoed(dup, "x-sample"))}`,
    `  重複(Host)    : status=${dupHost.status}` +
      (dupHost.status === 400 ? "（RFC 9112 §3.2 のとおり拒否）" : "（拒否されなかった）"),
    ""
  );

  emit(id, {
    order_changes_status: base.status !== swapped.status,
    order_preserved_on_wire: JSON.stringify(orderOf(base)) !== JSON.stringify(orderOf(swapped)),
    duplicate_joined_value: echoed(dup, "x-sample"),
    duplicate_x_sample_status: dup.status,
    duplicate_host_status: dupHost.status,
    status_order_base: base.status,
    status_order_swapped: swapped.status,
  }, log);
}

function runUpgrade() {
  const id = "002-upgrade";
  const log = header(id, "平文リクエストに Upgrade を付けたときの応答と、nginx が上流へ渡すか（RFC 9931 の規範要件はプロキシ / CONNECT が主体で本測定の対象外）");
  const url = `${EDGE}/002/api/echo`;

  const plain = probe({ url });
  const upgraded = probe({ url, headers: { Upgrade: "websocket", Connection: "Upgrade" } });
  const direct = probe({ url: `${APP}/002/api/echo`, headers: { Upgrade: "websocket", Connection: "Upgrade" } });

  const forwarded = (r) => {
    try {
      const h = JSON.parse(r.bodyText).headers ?? {};
      return { upgrade: h.upgrade ?? null, connection: h.connection ?? null };
    } catch {
      return { upgrade: null, connection: null };
    }
  };
  const viaNginx = forwarded(upgraded);
  const viaDirect = forwarded(direct);

  log.push(
    `  Upgrade なし          : status=${plain.status}`,
    `  Upgrade あり(nginx 経由): status=${upgraded.status} / 上流が見た Upgrade=${JSON.stringify(viaNginx.upgrade)} Connection=${JSON.stringify(viaNginx.connection)}`,
    `  Upgrade あり(直結)     : status=${direct.status} / アプリが見た Upgrade=${JSON.stringify(viaDirect.upgrade)}`,
    ""
  );

  emit(id, {
    status_without_upgrade: plain.status,
    status_with_upgrade_via_nginx: upgraded.status,
    status_with_upgrade_direct: direct.status,
    upgrade_forwarded_by_nginx: viaNginx.upgrade !== null,
    upgrade_seen_when_direct: viaDirect.upgrade !== null,
    switched_protocols: upgraded.status === 101 || direct.status === 101,
  }, log);
}

// ---------------------------------------------------------------- 002-header-size

/**
 * 大きいヘッダはどこで弾かれるか。
 *
 * 🔴 応答コードだけでは「nginx が弾いた」と「Express が弾いた」を分けられない（D11）。
 *    nginx→Express の経路では echo の本文に自分のヘッダが写っているかで到達を判定する。
 *
 * 既定値（公式ドキュメントで確認済・2026-08-18）:
 *   nginx  large_client_header_buffers 4 8k … 1 本のヘッダ行が 8k を超えると 400
 *   Node   --max-http-header-size 16 KiB   … 超過時の応答はドキュメントに明記がない
 */
function runHeaderSize() {
  const id = "002-header-size";
  const log = header(id, "1 本が長いヘッダ / 本数の多いヘッダを、上限の違う 3 経路 + 対照へ送る");

  const RAISED_HOST = "headersize.test"; // 同じ 87 番・server_name だけ別（上限 8 32k）

  const routes = [
    { key: "nginx_static", label: "nginx 単独（静的）", url: `${EDGE}/002/static/sample.html`, headers: {} },
    { key: "via_nginx", label: "nginx→Express", url: `${EDGE}/002/api/echo`, headers: {}, echo: true },
    { key: "app_direct", label: "Express 直結", url: `${APP}/002/api/echo`, headers: {}, echo: true },
    { key: "raised", label: "上限を上げた server（対照）", url: `${EDGE}/002/static/sample.html`, headers: { Host: RAISED_HOST } },
  ];

  // --- ケース A: 1 本のヘッダ行が長い
  //     ヘッダ行の長さ = "X-Big: ".length(7) + 値 + CRLF(2)
  const singleSizes = [4096, 8000, 8192, 9000, 16384, 20000];
  const single = {};
  for (const r of routes) {
    single[r.key] = [];
    for (const n of singleSizes) {
      const value = "a".repeat(n);
      const res = probe({ url: r.url, headers: { ...r.headers, "X-Big": value } });
      const reached = r.echo ? res.bodyText.includes(value.slice(0, 64)) : null;
      single[r.key].push({ value_bytes: n, line_bytes: 7 + n + 2, status: res.status, curl_exit: res.curlExit, reached_upstream: reached });
      log.push(`## A ${r.label} value=${n}B line=${7 + n + 2}B -> status=${res.status}` + (reached === null ? "" : ` reached_upstream=${reached}`));
      if (res.curlExit !== 0) log.push(`   curl-exit=${res.curlExit} stderr=${res.stderr}`);
    }
  }

  // --- ケース B: 本数が多い（1 本 1,000 バイト固定）
  const counts = [4, 8, 16, 32, 40];
  const many = {};
  for (const r of routes) {
    many[r.key] = [];
    for (const c of counts) {
      const headers = { ...r.headers };
      for (let i = 0; i < c; i++) headers[`X-Pad-${i}`] = "b".repeat(1000);
      const res = probe({ url: r.url, headers });
      many[r.key].push({ count: c, approx_total_bytes: c * (1000 + 12), status: res.status, curl_exit: res.curlExit });
      log.push(`## B ${r.label} count=${c} approx_total=${c * (1000 + 12)}B -> status=${res.status}`);
      if (res.curlExit !== 0) log.push(`   curl-exit=${res.curlExit} stderr=${res.stderr}`);
    }
  }

  // --- 境界の詰め: 既定 8k / Node 16 KiB の 1 バイト前後
  //     ヘッダ行 = "X-Big: "(7) + 値 + CRLF(2) なので、行を 8192 にするには値 8183。
  const edge = {};
  for (const [label, route, values] of [
    ["nginx_static", routes[0], [8183, 8184]],
    ["app_direct", routes[2], [16375, 16376]],
  ]) {
    edge[label] = values.map((n) => {
      const res = probe({ url: route.url, headers: { ...route.headers, "X-Big": "a".repeat(n) } });
      log.push(`## D ${route.label} value=${n}B line=${7 + n + 2}B -> status=${res.status}`);
      return { value_bytes: n, line_bytes: 7 + n + 2, status: res.status };
    });
  }

  // --- Express 直結の上限は「1 行」ではなく「ヘッダ全体の合計」に効く。
  //     二分探索で最初に 431 になる値を出す。🔴 この値は curl が既定で送る他のヘッダ
  //     （Host / User-Agent / Accept）込みの合計に依存するため、移植できる定数ではない。
  let lo = 9000, hi = 16375; // lo は 200 を確認済 / hi は 431 を確認済
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const res = probe({ url: routes[2].url, headers: { "X-Big": "a".repeat(mid) } });
    if (res.status === 200) lo = mid; else hi = mid;
  }
  log.push(`## E Express 直結の 431 境界  最後に通った値=${lo}B  最初に落ちた値=${hi}B`);

  // --- 400 のエラーページが User-Agent で伸びるか（P6・002-minimize と同型）
  const big = "a".repeat(9000);
  const withUA = probe({ url: `${EDGE}/002/static/sample.html`, headers: { "X-Big": big } });
  const withoutUA = probe({ url: `${EDGE}/002/static/sample.html`, headers: { "X-Big": big }, dropHeaders: ["User-Agent"] });
  log.push(`## C 400 ページの大きさ  UA あり=${withUA.bodyBytes}B  UA なし=${withoutUA.bodyBytes}B`);
  log.push("");

  /** 状態が最初に変わった値を返す（変わらなければ null） */
  const firstChange = (rows, base) => rows.find((x) => x.status !== base)?.value_bytes ?? null;
  const firstChangeCount = (rows, base) => rows.find((x) => x.status !== base)?.count ?? null;

  emit(id, {
    nginx_default_large_client_header_buffers: "4 8k",
    node_default_max_http_header_size_bytes: 16384,
    single_header_sizes_tested: singleSizes,
    status_single_4096_nginx_static: single.nginx_static[0].status,
    status_single_9000_nginx_static: single.nginx_static.find((x) => x.value_bytes === 9000).status,
    status_single_9000_via_nginx: single.via_nginx.find((x) => x.value_bytes === 9000).status,
    status_single_9000_app_direct: single.app_direct.find((x) => x.value_bytes === 9000).status,
    status_single_9000_raised: single.raised.find((x) => x.value_bytes === 9000).status,
    status_single_20000_app_direct: single.app_direct.find((x) => x.value_bytes === 20000).status,
    first_failing_single_value_bytes_nginx_static: firstChange(single.nginx_static, single.nginx_static[0].status),
    first_failing_single_value_bytes_app_direct: firstChange(single.app_direct, single.app_direct[0].status),
    reached_upstream_single_9000_via_nginx: single.via_nginx.find((x) => x.value_bytes === 9000).reached_upstream,
    header_counts_tested: counts,
    first_failing_count_nginx_static: firstChangeCount(many.nginx_static, many.nginx_static[0].status),
    first_failing_count_app_direct: firstChangeCount(many.app_direct, many.app_direct[0].status),
    first_failing_count_raised: firstChangeCount(many.raised, many.raised[0].status),
    // 🔴 同じ経路でも、大きさの作り方で弾く主体が入れ替わる（nginx 400 / Node 431）
    status_many_32_via_nginx: many.via_nginx.find((x) => x.count === 32).status,
    status_many_40_via_nginx: many.via_nginx.find((x) => x.count === 40).status,
    error_page_bytes_with_ua: withUA.bodyBytes,
    error_page_bytes_without_ua: withoutUA.bodyBytes,
    boundary_nginx_line_8192_status: edge.nginx_static[0].status,
    boundary_nginx_line_8193_status: edge.nginx_static[1].status,
    boundary_app_line_16384_status: edge.app_direct[0].status,
    boundary_app_line_16385_status: edge.app_direct[1].status,
    app_direct_last_ok_value_bytes: lo,
    app_direct_first_431_value_bytes: hi,
    per_edge: edge,
    per_single: single,
    per_many: many,
  }, log);
}

// ---------------------------------------------------------------- 入口

const SCENARIOS = {
  "002-minimize": runMinimize,
  "002-host": runHost,
  "002-expect": runExpect,
  "002-length": runLength,
  "002-conn-h2": runConnH2,
  "002-accept-encoding": runAcceptEncoding,
  "002-duplicate-order": runDuplicateOrder,
  "002-upgrade": runUpgrade,
  "002-header-size": runHeaderSize,
};

const arg = process.argv.slice(2).find((a) => a.startsWith("--scenario="));
const id = arg ? arg.slice("--scenario=".length) : null;
if (!id || !(id in SCENARIOS)) {
  console.error(`✗ USAGE: node tools/measure-002.mjs --scenario=<${Object.keys(SCENARIOS).join(" | ")}>`);
  process.exit(3);
}
await SCENARIOS[id]();
