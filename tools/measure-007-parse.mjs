#!/usr/bin/env node
// measure-007-parse.mjs — 型が合わないボディを送ったとき、経路上の誰が止めるかを測る（M1）
//
// 観測対象は「Express は 415 を返すのか」。返さないなら、どこまで通ってしまうのか。
// あわせて nginx（リバースプロキシ）が Content-Type を検査・書き換えするかを、
// 同じリクエストを 2 経路（nginx 経由 / Express 直結）へ送って比べる。
//
// 🔴 判定は生のステータスコードと応答本文のみで機械的に行う。
//    予測と食い違ってもそのまま記録する。
//
// 使い方: node tools/measure-007-parse.mjs
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "007-content-type-parse");
const VIA_NGINX = "http://localhost:8080";
const DIRECT_APP = "http://localhost:8086";

/** 送るケース。ct=null は Content-Type ヘッダ自体を送らない */
const CASES = [
  { id: "C1", desc: "application/json",                 ct: "application/json",                 body: '{"a":1}' },
  { id: "C2", desc: "application/json; charset=utf-8",  ct: "application/json; charset=utf-8",  body: '{"a":1}' },
  { id: "C3", desc: "大文字 APPLICATION/JSON",          ct: "APPLICATION/JSON",                 body: '{"a":1}' },
  { id: "C4", desc: "+json 接尾辞",                     ct: "application/vnd.api+json",         body: '{"a":1}' },
  { id: "C5", desc: "text/plain",                       ct: "text/plain",                       body: '{"a":1}' },
  { id: "C6", desc: "form エンコード",                  ct: "application/x-www-form-urlencoded", body: '{"a":1}' },
  { id: "C7", desc: "Content-Type なし",                ct: null,                               body: '{"a":1}' },
  { id: "C8", desc: "型は正しいが壊れた JSON",          ct: "application/json",                 body: '{"a":' },
  { id: "C9", desc: "未知の Content-Encoding",          ct: "application/json",                 body: '{"a":1}', enc: "foo" },
  { id: "C10", desc: "未対応 charset",                  ct: "application/json; charset=shift_jis", body: '{"a":1}' },
];

// 🔴 Content-Type を「付けない」ことを fetch では表現できない（2026-08-22 実測）。
//    Node の fetch は文字列ボディに Content-Type: text/plain;charset=UTF-8 を自動で足すため、
//    ct=null のケースが text/plain と同条件になり、C7 が C5 の重複になっていた。
//    記事は C7 を「ヘッダを付けない」と書いているので、出どころを記述に合わせる。
//    ヘッダを完全に制御するため、ct=null のときだけ node:http で生のリクエストを送る。
function rawPost(base, path, body, extraHeaders = {}) {
  const u = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: { "Content-Length": Buffer.byteLength(body), ...extraHeaders },
      },
      (res) => {
        let d = "";
        res.on("data", (ch) => (d += ch));
        res.on("end", () => resolve({ status: res.statusCode, text: d, headers: res.headers }));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

/** ケースを 1 件送る。ct=null は Content-Type ヘッダ自体を送らない（生リクエスト経路） */
async function post(base, path, c) {
  if (c.ct === null) {
    const extra = c.enc ? { "Content-Encoding": c.enc } : {};
    const r = await rawPost(base, path, c.body, extra);
    return { status: r.status, text: r.text, acceptHeader: r.headers["accept"] ?? null };
  }
  const headers = { "Content-Type": c.ct };
  if (c.enc) headers["Content-Encoding"] = c.enc;
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: c.body });
  return { status: res.status, text: await res.text(), acceptHeader: res.headers.get("accept") };
}

async function send(base, path, c) {
  const { status, text } = await post(base, path, c);
  let parsedBody = null;
  try {
    const j = JSON.parse(text);
    parsedBody = j.received === undefined ? null : j.received;
  } catch {
    /* Express 既定のエラーページは HTML。JSON でない = パース結果なし */
  }
  return {
    status,
    // 「ボディが読めたか」= req.body に中身が入ったか
    body_parsed: parsedBody !== null && parsedBody !== undefined && Object.keys(parsedBody ?? {}).length > 0,
    content_type_seen: (() => {
      try { return JSON.parse(text).contentType ?? null; } catch { return null; }
    })(),
  };
}

/** /007/echo-typed — 型が合わなかったとき req.body に何が入っているか（typeof をそのまま読む） */
async function sendTyped(base, c) {
  const { status, text } = await post(base, "/007/echo-typed", c);
  try {
    const j = JSON.parse(text);
    return { status, bodyType: j.bodyType ?? null, isUndefined: j.bodyIsUndefined ?? null };
  } catch {
    // 400 / 415 は express.json() が先に止めるため JSON 応答にならない。観測対象外として記録する
    return { status, bodyType: null, isUndefined: null };
  }
}

/** /007/echo-naive — 読者が素直に req.body.name と書いた場合に何が返るか */
async function sendNaive(base, c) {
  const { status, text } = await post(base, "/007/echo-naive", c);
  let errorName = null;
  try { errorName = JSON.parse(text).error ?? null; } catch { /* JSON でない応答 */ }
  return { status, errorName };
}

async function main() {
  // 🔴 再実行の累積を避けるため出力先を作り直す。追記にすると前回の結果が残り、
  //    失敗したケースが成功したように見える。
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const lines = [
    "# 007-content-type-parse (M1)",
    `measured-at: ${new Date().toISOString()}`,
    `node: ${process.version}`,
    `via-nginx: ${VIA_NGINX} / direct-app: ${DIRECT_APP}`,
    "",
  ];
  const summary = { scenario: "007-content-type-parse", mode: "M1" };

  lines.push("## /007/echo — 既定の express.json()（先回りの検査を足していない）");
  for (const c of CASES) {
    const via = await send(VIA_NGINX, "/007/echo", c);
    const direct = await send(DIRECT_APP, "/007/echo", c);
    const same = via.status === direct.status && via.body_parsed === direct.body_parsed;
    lines.push(
      `${c.id.padEnd(4)} ${c.desc.padEnd(28)} nginx=${via.status} parsed=${via.body_parsed}` +
        `  direct=${direct.status} parsed=${direct.body_parsed}  ${same ? "一致" : "乖離"}`
    );
    summary[`${c.id}_status`] = via.status;
    summary[`${c.id}_body_parsed`] = via.body_parsed;
    summary[`${c.id}_nginx_equals_direct`] = same;
    // nginx が Content-Type を書き換えていないか（到着した値をそのまま記録）
    // 🔴 ct=null のケースも記録する（2026-08-22）。以前は if (c.ct) で除外していたため、
    //    「ヘッダを付けない」という C7 の条件そのものが機械検査の外にあった。
    //    実際、fetch の自動付与で C7 は text/plain と同条件になっていたが、記録が無いため検出できなかった。
    summary[`${c.id}_content_type_seen`] = via.content_type_seen;
  }

  lines.push("", "## /007/echo-strict — 受信側で自分で検査を書いた対照");
  for (const c of [CASES[0], CASES[4], CASES[3]]) {
    const r = await send(VIA_NGINX, "/007/echo-strict", c);
    lines.push(`${c.id.padEnd(4)} ${c.desc.padEnd(28)} status=${r.status}`);
    summary[`strict_${c.id}_status`] = r.status;
  }

  // 415 を返すときに Accept を添えられるか（RFC 9110 §15.5.16）
  const strictRes = await fetch(`${VIA_NGINX}/007/echo-strict`, {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}",
  });
  summary.strict_415_accept_header = strictRes.headers.get("accept");
  lines.push("", `415 応答の Accept ヘッダ: ${summary.strict_415_accept_header}`);

  // --- req.body の実体（express 5 系は型が合わないと設定しない・#6432）---
  lines.push("", "## /007/echo-typed — 型が合わなかったとき req.body に何が入っているか");
  for (const c of CASES) {
    const t = await sendTyped(VIA_NGINX, c);
    lines.push(
      `${c.id.padEnd(4)} ${c.desc.padEnd(28)} status=${t.status} typeof=${t.bodyType ?? "（JSON 応答なし）"}` +
        (t.isUndefined === null ? "" : ` isUndefined=${t.isUndefined}`)
    );
    if (t.bodyType !== null) summary[`${c.id}_body_type`] = t.bodyType;
  }

  // --- 読者が素直に書いた場合の対照 ---
  lines.push("", "## /007/echo-naive — req.body.name と直接書いた対照");
  for (const c of [CASES[0], CASES[4]]) {
    const nv = await sendNaive(VIA_NGINX, c);
    lines.push(`${c.id.padEnd(4)} ${c.desc.padEnd(28)} status=${nv.status}${nv.errorName ? ` error=${nv.errorName}` : ""}`);
    summary[`naive_${c.id}_status`] = nv.status;
    if (nv.errorName) summary[`naive_${c.id}_error`] = nv.errorName;
  }

  // --- 配信側: 型が text/html になってしまう代表原因（パスが実在しない）---
  //
  // 読者がコンソールで「MIME タイプ (text/html) の不一致により」を見るとき、
  // 配る型そのものが text/html になっていることが多い。その代表原因を測る。
  lines.push("", "## 配信側 — 型が text/html になる代表原因（パスが実在しない）");
  {
    const missing = await fetch(`${VIA_NGINX}/007/does-not-exist.js`);
    summary.missing_path_status = missing.status;
    summary.missing_path_content_type = missing.headers.get("content-type");
    const ok = await fetch(`${VIA_NGINX}/007/asset?kind=js&ct=text/javascript&flag=ctl`);
    summary.asset_js_status = ok.status;
    summary.asset_js_content_type = ok.headers.get("content-type");
    lines.push(
      `存在しないパス   /007/does-not-exist.js        status=${summary.missing_path_status} content-type=${summary.missing_path_content_type}`,
      `対照（正しい配信）/007/asset?ct=text/javascript status=${summary.asset_js_status} content-type=${summary.asset_js_content_type}`
    );
  }

  // 何件が 415 になったか / ならなかったか
  const echoStatuses = CASES.map((c) => summary[`${c.id}_status`]);
  summary.cases_total = CASES.length;
  summary.cases_415 = echoStatuses.filter((s) => s === 415).length;
  summary.cases_200 = echoStatuses.filter((s) => s === 200).length;
  summary.mismatch_cases_returning_415 = 0; // 下で埋める（型不一致だけを数える）
  const MISMATCH_IDS = ["C4", "C5", "C6", "C7"];
  summary.mismatch_cases_returning_415 = MISMATCH_IDS.filter((id) => summary[`${id}_status`] === 415).length;
  summary.mismatch_cases_total = MISMATCH_IDS.length;

  lines.push(
    "",
    `全 ${summary.cases_total} ケース中 415 = ${summary.cases_415} 件 / 200 = ${summary.cases_200} 件`,
    `うち「型の不一致」${summary.mismatch_cases_total} ケースで 415 になったのは ${summary.mismatch_cases_returning_415} 件`
  );

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(lines.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
