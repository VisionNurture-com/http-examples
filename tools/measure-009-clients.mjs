#!/usr/bin/env node
// measure-009-clients.mjs — リダイレクトを越えたとき、言語ごとの HTTP クライアントは
//                           Authorization を落とすか（M2）
//
// 🔴 CI では回りません（6 つのランタイムを要するため）。run.sh の mode: M2 は
//    「手元でのみ回る」の意味で、ブラウザを使うという意味ではありません（004 と同じ規約）。
//
// 🔴 判定は終端 /009/whoami が報告した到着内容のみで機械的に行う。
//    クライアントが自分で報告した内容は使わない。
//
// 前提: docker compose up -d --wait

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// 🔴 B4（http → https）はローカルの証明書を使う。ブラウザと curl は OS の信頼ストアを
//    見るので通るが、python / java / node / bun はそれぞれ別の信頼ストアを持つため、
//    何もしないと **TLS の検証失敗**になる。それは「Authorization が落ちた」ではない。
//    信頼だけを渡して、測りたい挙動と無関係な失敗を測定から取り除く。
//    （信頼ストアの設定はリダイレクト時のヘッダの扱いを変えない）
const CAROOT = join(homedir(), "Library", "Application Support", "mkcert", "rootCA.pem");

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "009-redirect-clients";
const OUT = join(ROOT, "results", ID);
const BASE = "http://localhost:8080";

const CASES = [
  { id: "B0", path: "/009/whoami", desc: "対照（リダイレクトなし）" },
  { id: "B1", path: "/009/redirect/same", desc: "同一オリジン・パス差" },
  { id: "B2", path: "/009/redirect/port", desc: "ポートだけ違う" },
  { id: "B3", path: "/009/redirect/host", desc: "ホストだけ違う" },
  { id: "B4", path: "/009/redirect/scheme", desc: "http → https" },
  { id: "B5", path: "/009/redirect/back", desc: "元のオリジンへ復帰（A→B→A）" },
  { id: "B6", path: "/009/redirect/same-then-cross", desc: "同一→別（A1→A2→B）" },
  // 🔴 Go の net/http は「最初のドメインと exact match または subdomain match」で判定すると
  //    公式ドキュメントが規定している。ホスト差（B3）だけでは exact match しか確かめられない。
  { id: "B7", path: "/009/redirect/subdomain", desc: "サブドメイン（localhost→sub.localhost）" },
];

const CLIENTS = [
  ["curl", "curl", (u) => ["--silent", "--show-error", "--max-time", "20", "--location", "--header", "Authorization: Bearer MEASUREMENT-TOKEN", u], {}, "コマンドラインの既定（-L）"],
  ["python-requests", "python3", (u) => ["tools/009-clients/follow_requests.py", u], { REQUESTS_CA_BUNDLE: CAROOT }, "requests（既定でリダイレクトを追う）"],
  ["java-httpclient", "java", (u) => [`-Djavax.net.ssl.trustStoreType=KeychainStore`, "tools/009-clients/Follow.java", u], {}, "java.net.http（followRedirects(NORMAL)）"],
  ["go-nethttp", "go", (u) => ["run", "tools/009-clients/follow.go", u], {}, "net/http（既定）"],
  ["ruby-openuri", "ruby", (u) => ["tools/009-clients/follow.rb", u], { SSL_CERT_FILE: CAROOT }, "open-uri（Net::HTTP は自分では追わない）"],
  // 🔴 対処つきの Ruby。素の open-uri が別ホストへも送ってしまうのに対し、
  //    request_specific_fields で宛先を検査すると止まる。決定表に載せるため同じ 7 ケースで測る。
  ["ruby-openuri-guarded", "ruby", (u) => ["tools/009-clients/follow_guarded.rb", u], { SSL_CERT_FILE: CAROOT }, "open-uri + request_specific_fields（宛先を検査）"],
  ["node-fetch", "node", (u) => ["tools/009-clients/follow_fetch.mjs", u], { NODE_EXTRA_CA_CERTS: CAROOT }, "undici の fetch"],
  ["bun-fetch", "bun", (u) => ["tools/009-clients/follow_fetch.mjs", u], { NODE_EXTRA_CA_CERTS: CAROOT }, "bun の fetch"],
];

function versionOf(cmd) {
  const probe = {
    curl: ["--version"], python3: ["--version"], java: ["--version"],
    go: ["version"], ruby: ["--version"], node: ["--version"], bun: ["--version"],
  }[cmd] ?? ["--version"];
  const r = spawnSync(cmd, probe, { encoding: "utf8" });
  return ((r.stdout ?? "") + (r.stderr ?? "")).split("\n")[0].trim();
}

function run(cmd, argv, extraEnv = {}) {
  const r = spawnSync(cmd, argv, { encoding: "utf8", cwd: ROOT, timeout: 60000, env: { ...process.env, ...extraEnv } });
  const text = (r.stdout ?? "").trim();
  try {
    const j = JSON.parse(text);
    return { auth: j.auth ?? null, host: j.host ?? null };
  } catch {
    return { auth: "error", host: null, raw: text.slice(0, 200) || (r.stderr ?? "").trim().slice(0, 200) };
  }
}

function main() {
  // 🔴 再実行の累積を避けるため出力先を作り直す
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const versions = {};
  for (const [label, cmd] of CLIENTS) versions[label] = versionOf(cmd);

  const lines = [
    `# ${ID} (M2)`,
    `measured-at: ${new Date().toISOString()}`,
    `base: ${BASE}`,
    "",
    "## 測ったランタイムの版",
    ...CLIENTS.map(([label]) => `  ${label.padEnd(18)} ${versions[label]}`),
    "",
    "判定は終端 /009/whoami が報告した到着内容のみ。値そのものは記録しない。",
    "",
  ];
  const summary = { scenario: ID, mode: "M2", client_versions: versions };

  for (const c of CASES) {
    const cells = [];
    for (const [label, cmd, argv, env] of CLIENTS) {
      const r = run(cmd, argv(`${BASE}${c.path}`), env);
      summary[`${c.id}_${label}`] = r.auth;
      cells.push(`${label}=${r.auth}`);
    }
    const auths = CLIENTS.map(([label]) => summary[`${c.id}_${label}`]);
    const agree = new Set(auths).size === 1;
    summary[`${c.id}_clients_agree`] = agree;
    lines.push(`${c.id.padEnd(3)} ${c.desc.padEnd(30)} ${cells.join(" ")}  ${agree ? "一致" : "🔴 乖離"}`);
  }

  const diverged = CASES.filter((c) => !summary[`${c.id}_clients_agree`]).map((c) => c.id);
  summary.diverged_cases = diverged;
  summary.diverged_count = diverged.length;
  summary.cases_total = CASES.length;
  summary.clients_total = CLIENTS.length;
  // 別ホストへ資格情報を送ったクライアント（B3 = ホストだけが違う）
  summary.sent_to_other_host = CLIENTS.filter(([l]) => summary[`B3_${l}`] === "yes").map(([l]) => l);

  lines.push(
    "",
    `全 ${CASES.length} ケース / ${CLIENTS.length} クライアント。判定が割れたのは ${diverged.length} ケース: ${diverged.join(", ") || "なし"}`,
    `ホストだけが違うリダイレクト（B3）で資格情報を送ったのは: ${summary.sent_to_other_host.join(", ") || "なし"}`
  );

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(lines.join("\n"));
}

main();
