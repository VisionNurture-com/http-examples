#!/usr/bin/env node
// measure-009-redirect.mjs — リダイレクトを越えたとき Authorization が残るか（M1・curl）
//
// 観測対象は「オリジンの境界がどこで切れるか」。オリジンは scheme + host + port で
// 決まるため、3 要素を 1 つずつ振って、どれで落ちるかを見る。
//
// 🔴 判定は終端（/009/whoami）が自分で報告した到着内容のみで機械的に行う。
//    予測と食い違ってもそのまま記録する。
//
// 🔴 資格情報の値は記録しない。あるか / ないかとスキーム名だけを残す。
//
// 使い方: node tools/measure-009-redirect.mjs
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "009-redirect-origin";
const OUT = join(ROOT, "results", ID);
const BASE = "http://localhost:8080";
const TOKEN = "Bearer MEASUREMENT-TOKEN";

/**
 * 振る軸。オリジン = (scheme, host, port)。
 *
 * 🔴 B4 はスキームとポートが同時に変わる。http は 80 / https は 443 を使うため、
 *    スキームだけを変えた対照は同一ポートで両プロトコルを出せない以上つくれない。
 *    B2 が単独でポート差を押さえるので、B4 が落ちても「スキームのせい」とは言わない。
 */
const CASES = [
  { id: "B0", path: "/009/whoami", desc: "対照（リダイレクトなし）", axis: "—" },
  { id: "B1", path: "/009/redirect/same", desc: "同一オリジン・パス差", axis: "パス" },
  { id: "B2", path: "/009/redirect/port", desc: "ポートだけ違う", axis: "ポート" },
  { id: "B3", path: "/009/redirect/host", desc: "ホストだけ違う", axis: "ホスト" },
  { id: "B4", path: "/009/redirect/scheme", desc: "http → https", axis: "スキーム + ポート", insecure: true },
  { id: "B5", path: "/009/redirect/back", desc: "元のオリジンへ復帰（A→B→A）", axis: "2 ホップ" },
  { id: "B6", path: "/009/redirect/same-then-cross", desc: "同一→別（A1→A2→B）", axis: "2 ホップ" },
];

const MODES = [
  { id: "L", flag: "--location", label: "curl -L（既定）" },
  { id: "T", flag: "--location-trusted", label: "curl --location-trusted" },
];

function curlVersion() {
  const r = spawnSync("curl", ["--version"], { encoding: "utf8" });
  return (r.stdout ?? "").split("\n")[0].trim();
}

/**
 * 1 ケースを送り、終端が報告した到着内容を返す。判定は生の応答のみで行う。
 *
 * 🔴 B4（http → https）はローカルの証明書を使う。手元は mkcert（OS の信頼ストアに入る）だが
 *    CI には mkcert が無く自己署名になるため、何もしないと **TLS の検証失敗**になる。
 *    それは「Authorization が落ちた」ではないので、証明書の検証だけを外して
 *    測りたい挙動と無関係な失敗を取り除く（検証の可否はリダイレクト時のヘッダの扱いを変えない）。
 */
function send(path, flag, insecure = false) {
  const args = [
    "--silent", "--show-error", "--max-time", "20",
    ...(insecure ? ["--insecure"] : []),
    flag,
    "--header", `Authorization: ${TOKEN}`,
    "--write-out", "\\n__HTTP__%{http_code} __URL__%{url_effective} __HOPS__%{num_redirects}",
    `${BASE}${path}`,
  ];
  const r = spawnSync("curl", args, { encoding: "utf8" });
  if (r.status !== 0) {
    return { error: (r.stderr ?? "").trim() || `curl exit ${r.status}`, auth: null };
  }
  const text = r.stdout ?? "";
  const meta = text.match(/__HTTP__(\d+) __URL__(\S+) __HOPS__(\d+)/);
  const bodyText = text.split("\n__HTTP__")[0];
  let body = null;
  try { body = JSON.parse(bodyText); } catch { /* JSON でない応答はそのまま null */ }
  return {
    status: meta ? Number(meta[1]) : null,
    finalUrl: meta ? meta[2] : null,
    hops: meta ? Number(meta[3]) : null,
    auth: body?.auth ?? null,
    scheme: body?.scheme ?? null,
    host: body?.host ?? null,
    raw: bodyText.trim(),
  };
}

function main() {
  // 🔴 再実行の累積を避けるため出力先を作り直す
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const version = curlVersion();
  const lines = [
    `# ${ID} (M1)`,
    `measured-at: ${new Date().toISOString()}`,
    `client: ${version}`,
    `base: ${BASE}`,
    "",
    "判定は終端 /009/whoami が報告した到着内容のみで行う。値そのものは記録しない。",
    "",
  ];
  // 🔴 curl の版は summary に残すが、expected.md の突合値には入れない。
  //    M1 は CI でも走るため、機種ごとに違う値を突合すると必ず落ちる（測定条件であって実効値ではない）。
  const summary = { scenario: ID, mode: "M1", curl_version: version.split(" ")[1] ?? null };

  for (const m of MODES) {
    lines.push(`## ${m.label}`);
    for (const c of CASES) {
      const r = send(c.path, m.flag, c.insecure === true);
      const key = `${c.id}_${m.id}`;
      if (r.error) {
        lines.push(`${c.id.padEnd(3)} ${c.desc.padEnd(30)} ERROR ${r.error}`);
        summary[`${key}_auth`] = "error";
        continue;
      }
      lines.push(
        `${c.id.padEnd(3)} ${c.desc.padEnd(30)} 軸=${String(c.axis).padEnd(16)} ` +
          `status=${r.status} hops=${r.hops} auth=${r.auth} scheme=${r.scheme ?? "-"} host=${r.host}`
      );
      summary[`${key}_auth`] = r.auth;
      summary[`${key}_hops`] = r.hops;
      summary[`${key}_status`] = r.status;
    }
    lines.push("");
  }

  // 集計: 既定の -L で資格情報が届いたケース
  const arrivedDefault = CASES.filter((c) => summary[`${c.id}_L_auth`] === "yes").map((c) => c.id);
  const arrivedTrusted = CASES.filter((c) => summary[`${c.id}_T_auth`] === "yes").map((c) => c.id);
  summary.default_arrived_cases = arrivedDefault;
  summary.default_arrived_count = arrivedDefault.length;
  summary.trusted_arrived_count = arrivedTrusted.length;
  summary.cases_total = CASES.length;

  lines.push(
    `全 ${CASES.length} ケース中、curl -L（既定）で届いたのは ${arrivedDefault.length} 件: ${arrivedDefault.join(", ")}`,
    `--location-trusted では ${arrivedTrusted.length} 件`
  );

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(lines.join("\n"));
}

main();
