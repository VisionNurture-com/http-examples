#!/usr/bin/env node
// measure-003.mjs — 記事 003 の M1 シナリオを測る（curl・CI で回る）
//
// 測るもの:
//   003-put-idempotent … 同じ PUT を 3 回送ったときサーバ状態がどう動くか
//   003-delete-repeat  … 2 回目の DELETE で状態と応答がそれぞれどうなるか
//   003-patch-semantics… PATCH の再送が形式と操作でどう変わるか
//   003-safe-get       … 状態を変える GET を HEAD が踏むか
//   003-redirect-method… 301〜308 でメソッドとボディがどうなるか（クライアント = curl）
//
// 🔴 判定方針（value-factcheck G3 の D3）: 冪等性は**サーバ状態**で判定する。
//    「2 回目も同じ応答か」では定義とずれるため、応答は別の欄に記録するだけにする。
//
// 🔴 予測を書かない（G3 問 5）。集計は観測値から機械的に作る。
//
// 使い方: node tools/measure-003.mjs --scenario=003-put-idempotent

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = "http://localhost:8085";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** -i の出力から最後の応答（ヘッダ + 本文）を取り出す。-L では応答が連なる */
function parseResponse(text) {
  const parts = text.split(/\r?\n\r?\n/);
  let lastHead = -1;
  parts.forEach((p, i) => {
    if (/^HTTP\/[\d.]+ \d{3}/.test(p)) lastHead = i;
  });
  const head = parts[lastHead] ?? "";
  const body = parts.slice(lastHead + 1).join("\n\n");
  return {
    status: Number((head.match(/^HTTP\/[\d.]+ (\d{3})/m) || [])[1] ?? 0),
    head: head.trim(),
    body: body.trim(),
  };
}

function curlRaw(extra) {
  return execFileSync("curl", ["-sS", ...extra], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

function send(method, path, { data = null, ctype = null, extra = [] } = {}) {
  const a = ["-i", "-X", method];
  if (ctype) a.push("-H", `Content-Type: ${ctype}`);
  if (data !== null) a.push("--data-binary", data);
  a.push(...extra, `${BASE}${path}`);
  return parseResponse(curlRaw(a));
}

function state() {
  return JSON.parse(parseResponse(curlRaw(["-i", `${BASE}/003/state`])).body);
}

function reset() {
  send("POST", "/003/__reset");
}

/** 状態のスナップショット列から相異なるものの数を数える */
function distinct(snapshots) {
  return new Set(snapshots.map((s) => JSON.stringify(s))).size;
}

// ---------------------------------------------------------------- シナリオ

const SCENARIOS = {
  // ① 同じ PUT を 3 回。実装の 4 系統を同じ手続きで測る
  "003-put-idempotent": async (log) => {
    const SENDS = 3;
    const variants = [
      ["replace", "/003/put/replace/doc"],
      ["stamped", "/003/put/stamped/doc"],
      ["append", "/003/put/append/doc"],
      ["numbered", "/003/put/numbered/doc"],
    ];
    const payload = JSON.stringify({ title: "spec", body: "same bytes every time" });

    const distinctStates = {};
    const statuses = {};
    let rejected = 0;

    for (const [name, path] of variants) {
      reset();
      const snaps = [];
      const codes = [];
      for (let i = 0; i < SENDS; i++) {
        const r = send("PUT", path, { data: payload, ctype: "application/json" });
        codes.push(r.status);
        if (r.status >= 400) rejected++;
        snaps.push(state().docs);
        log.push(`## ${name} 送信 ${i + 1}/${SENDS}`);
        log.push(`status=${r.status}`);
        log.push(`state.docs=${JSON.stringify(snaps[i])}`);
        log.push("");
        // 更新時刻をサーバで打つ実装は、同じミリ秒に収まると差が消える。
        // 測っているのは実装の冪等性であって時計の分解能ではないので間隔を空ける。
        await sleep(50);
      }
      distinctStates[name] = distinct(snaps);
      statuses[name] = codes;
    }

    // 陽性対照。POST は毎回作る
    reset();
    const postSnaps = [];
    for (let i = 0; i < SENDS; i++) {
      const r = send("POST", "/003/post/collection", { data: payload, ctype: "application/json" });
      postSnaps.push(state().created);
      log.push(`## control:post 送信 ${i + 1}/${SENDS}`);
      log.push(`status=${r.status} body=${r.body}`);
      log.push(`state.created=${JSON.stringify(postSnaps[i])}`);
      log.push("");
    }

    return {
      sends_per_variant: SENDS,
      variants_measured: variants.length,
      distinct_states_after_sends: distinctStates,
      status_sequence: statuses,
      control_post_distinct_states: distinct(postSnaps),
      control_post_created_count: postSnaps.at(-1).length,
      // 「メソッドの性質が実装を縛らない」ことの直接の観測。
      // 同じ PUT の反復を nginx も Express も 1 度も拒んでいない
      repeats_rejected_by_stack: rejected,
    };
  },

  // ② 2 回目の DELETE。状態と応答を分けて記録する
  "003-delete-repeat": async (log) => {
    const SENDS = 2;
    const variants = [
      ["strict", "/003/delete/strict/a"],
      ["lenient", "/003/delete/lenient/b"],
      ["echo", "/003/delete/echo/c"],
    ];
    const statusSeq = {};
    const bodySeq = {};
    const stateSame = {};
    const responseSame = {};

    for (const [name, path] of variants) {
      reset();
      const codes = [];
      const bodies = [];
      const snaps = [];
      for (let i = 0; i < SENDS; i++) {
        const r = send("DELETE", path);
        codes.push(r.status);
        bodies.push(r.body);
        snaps.push(state().items);
        log.push(`## ${name} 送信 ${i + 1}/${SENDS}`);
        log.push(`status=${r.status} body=${JSON.stringify(r.body)}`);
        log.push(`state.items=${JSON.stringify(snaps[i])}`);
        log.push("");
      }
      statusSeq[name] = codes;
      bodySeq[name] = bodies;
      stateSame[name] = distinct(snaps) === 1;
      responseSame[name] = new Set(codes.map((c, i) => `${c}|${bodies[i]}`)).size === 1;
    }

    return {
      sends_per_variant: SENDS,
      variants_measured: variants.length,
      status_sequence: statusSeq,
      state_same_after_repeat: stateSame,
      response_same_after_repeat: responseSame,
    };
  },

  // ③ PATCH の再送。形式（merge / json）と操作（replace / add）で分ける
  "003-patch-semantics": async (log) => {
    const SENDS = 3;
    const cases = [
      ["merge_set", "/003/patch/merge", "application/merge-patch+json", JSON.stringify({ title: "final" })],
      ["merge_delete", "/003/patch/merge", "application/merge-patch+json", JSON.stringify({ title: null })],
      [
        "json_replace",
        "/003/patch/json",
        "application/json-patch+json",
        JSON.stringify([{ op: "replace", path: "/title", value: "final" }]),
      ],
      [
        "json_add_append",
        "/003/patch/json",
        "application/json-patch+json",
        JSON.stringify([{ op: "add", path: "/tags/-", value: "rest" }]),
      ],
    ];

    const distinctStates = {};
    const finalState = {};
    const statuses = {};

    for (const [name, path, ctype, data] of cases) {
      reset();
      const snaps = [];
      const codes = [];
      for (let i = 0; i < SENDS; i++) {
        const r = send("PATCH", path, { data, ctype });
        codes.push(r.status);
        snaps.push(JSON.parse(r.body));
        log.push(`## ${name} 送信 ${i + 1}/${SENDS}`);
        log.push(`content-type=${ctype}`);
        log.push(`status=${r.status} state=${r.body}`);
        log.push("");
      }
      distinctStates[name] = distinct(snaps);
      finalState[name] = snaps.at(-1);
      statuses[name] = codes;
    }

    return {
      sends_per_case: SENDS,
      cases_measured: cases.length,
      media_types_measured: ["application/json-patch+json", "application/merge-patch+json"],
      distinct_states_after_sends: distinctStates,
      final_state: finalState,
      status_sequence: statuses,
    };
  },

  // ④ 状態を変える GET。HEAD が同じハンドラを踏むか
  "003-safe-get": async (log) => {
    reset();
    const GETS = 3;
    for (let i = 0; i < GETS; i++) {
      const r = send("GET", "/003/unsafe/consume?token=curl&cs=get");
      log.push(`## GET ${i + 1}/${GETS}`);
      log.push(`status=${r.status} body=${r.body}`);
      log.push("");
    }
    const afterGet = state().quota.curl ?? 0;

    // HEAD は自分では 1 行も書いていない経路。app.get() のハンドラに落ちるかを見る
    const headRes = parseResponse(curlRaw(["-i", "-I", `${BASE}/003/unsafe/consume?token=head&cs=head`]));
    const afterHead = state().quota.head ?? 0;
    log.push("## HEAD 1/1");
    log.push(headRes.head);
    log.push(`body_bytes=${headRes.body.length}`);
    log.push("");

    // 対照。本当に読むだけの GET は状態を動かさない
    const before = JSON.stringify(state().quota);
    for (let i = 0; i < GETS; i++) send("GET", "/003/state");
    const after = JSON.stringify(state().quota);
    log.push("## control:safe-get（読むだけの GET を 3 回）");
    log.push(`quota_before=${before}`);
    log.push(`quota_after=${after}`);
    log.push("");

    return {
      get_sends: GETS,
      consumed_after_get_sends: afterGet,
      head_sends: 1,
      consumed_after_head: afterHead,
      head_status: headRes.status,
      head_response_body_bytes: headRes.body.length,
      control_safe_get_changed_state: before !== after,
    };
  },

  // ⑤ リダイレクトでメソッドとボディがどうなるか。クライアントは curl
  "003-redirect-method": async (log) => {
    const codes = [301, 302, 303, 307, 308];
    // 同じ「POST を送る」でも書き方で結果が変わるため 3 通りを並べる
    const variants = [
      ["implicit", []], // -d だけ（メソッドは curl が決める）
      ["forced", ["-X", "POST"]], // メソッド名を明示する書き方
      ["post30x", ["--post301", "--post302", "--post303"]], // 変換をやめさせる指定
    ];
    const payload = "amount=1000";

    const method = {};
    const bodyBytes = {};

    for (const [vname, extra] of variants) {
      method[vname] = {};
      bodyBytes[vname] = {};
      for (const code of codes) {
        reset();
        const a = ["-i", "-L", ...extra, "-H", "Content-Type: text/plain", "--data-binary", payload,
                   `${BASE}/003/redirect/${code}?cs=${vname}`];
        const r = parseResponse(curlRaw(a));
        const arrival = state().arrivals.at(-1) ?? null;
        method[vname][code] = arrival?.method ?? null;
        bodyBytes[vname][code] = arrival?.body_length ?? null;
        log.push(`## ${vname} / ${code}`);
        log.push(`curl-args=${JSON.stringify(["-L", ...extra, "--data-binary", payload])}`);
        log.push(`final-status=${r.status}`);
        log.push(`arrival=${JSON.stringify(arrival)}`);
        log.push("");
      }
    }

    return {
      codes_measured: codes,
      request_body_bytes_sent: payload.length,
      method_at_destination: method,
      body_bytes_at_destination: bodyBytes,
    };
  },
};

// ---------------------------------------------------------------- 実行

const id = args.scenario;
if (!id || !SCENARIOS[id]) {
  console.error(`✗ USAGE [measure-003] --scenario=<${Object.keys(SCENARIOS).join(" | ")}>`);
  process.exit(3);
}

const dir = join(ROOT, "results", id);
mkdirSync(dir, { recursive: true });

const log = [];
const nginx = execFileSync("docker", ["compose", "exec", "-T", "edge", "nginx", "-v"], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
const meta = JSON.parse(parseResponse(curlRaw(["-i", `${BASE}/__meta`])).body);
const curlVersion = (execFileSync("curl", ["--version"], { encoding: "utf8" }).split("\n")[0].match(/curl ([\d.]+)/) || [])[1];

const header = [
  `measured-at: ${new Date().toISOString()}`,
  `scenario: ${id}`,
  `mode: M1`,
  `base: ${BASE}`,
  `nginx: ${nginx}`,
  `node: ${meta.node}`,
  `curl: ${curlVersion}`,
  "---",
  "",
];

const values = await SCENARIOS[id](log);

writeFileSync(join(dir, "run.log"), header.concat(log).join("\n") + "\n");
writeFileSync(
  join(dir, "summary.json"),
  JSON.stringify({ ...values, client: "curl", curl_version: curlVersion }, null, 2) + "\n"
);
console.log(`[measure-003] ${id} — ${Object.keys(values).length} 項目を記録しました`);
