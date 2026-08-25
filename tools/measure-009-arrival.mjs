#!/usr/bin/env node
// measure-009-arrival.mjs — 既定で Authorization を落とす構成はどれか（M1）
//
// 通説は「リバースプロキシを挟むと Authorization が消える」。公式ドキュメントを読むと
// nginx が既定で再定義するのは Host と Connection だけで、Authorization は素通りする。
// 一方 Apache は CGIPassAuth の既定が Off で、CGI からヘッダを隠す。
// どちらが起きるのかを、同じリクエストを 8 経路へ送って確かめる。
//
// P6 / P7 は「落ちたあと読者が実際に打つ対処」。国内の解説記事は .htaccess に
// mod_rewrite / mod_setenvif で環境変数へ写す手を案内している。効くかどうかを測る。
//
// 🔴 P8 は同じ .htaccess に CGIPassAuth On そのものを置く。公式は本ディレクティブの
//    Context を directory と .htaccess、Override を AuthConfig と定めており、
//    「サーバ全体の設定だから利用者は触れない」は正確ではない。環境変数へ写す手と
//    どちらでも届くのかを対照で確かめる。
//
// 🔴 判定は各終端が自分で報告した到着内容のみで機械的に行う。
// 🔴 資格情報の値は記録しない。あるか / ないかとスキーム名だけを残す。
//
// 使い方: node tools/measure-009-arrival.mjs
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ID = "009-header-arrival";
const OUT = join(ROOT, "results", ID);
const TOKEN = "Bearer MEASUREMENT-TOKEN";

const PATHS = [
  {
    id: "P0", kind: "対照", url: "http://localhost:8086/009/whoami",
    desc: "Express 直（対照）", stack: "app",
    basis: "プロキシを挟まない対照",
  },
  {
    id: "P1", kind: "既定", url: "http://localhost:8092/009/proxy/whoami",
    desc: "nginx proxy_pass（既定）", stack: "nginx → app",
    basis: "既定で再定義されるのは Host と Connection だけ",
  },
  {
    id: "P2", kind: "落とす設定", url: "http://localhost:8092/009/strip/whoami",
    desc: 'nginx + proxy_set_header Authorization ""', stack: "nginx → app",
    basis: "値が空文字列のヘッダーはプロキシ先へ渡されない",
  },
  {
    id: "P3", kind: "既定", url: "http://localhost:8092/009/fcgi/whoami",
    desc: "nginx fastcgi_pass → PHP-FPM", stack: "nginx → php-fpm",
    basis: "fastcgi_pass_request_headers は既定 on",
  },
  {
    id: "P4", kind: "既定", url: "http://localhost:8093/009/cgi-off/whoami.cgi",
    desc: "Apache mod_cgid（CGIPassAuth 既定 Off）", stack: "httpd → cgi",
    basis: "Normally these HTTP headers are hidden from scripts.",
  },
  {
    id: "P5", kind: "直す設定", url: "http://localhost:8093/009/cgi-on/whoami.cgi",
    desc: "Apache mod_cgid（CGIPassAuth On）", stack: "httpd → cgi",
    basis: "同ディレクティブの明示的な解除",
  },
  {
    id: "P6", kind: "直す設定", url: "http://localhost:8093/009/cgi-rewrite/whoami.cgi",
    desc: "同上 + .htaccess の mod_rewrite（E=HTTP_AUTHORIZATION）", stack: "httpd → cgi",
    basis: "CGIPassAuth は既定 Off のまま。値を環境変数へ自分で写す",
  },
  {
    id: "P7", kind: "直す設定", url: "http://localhost:8093/009/cgi-setenvif/whoami.cgi",
    desc: "同上 + .htaccess の SetEnvIf", stack: "httpd → cgi",
    basis: "同じ目的をもう 1 つの書き方で（mod_rewrite を使わない）",
  },
  {
    id: "P8", kind: "直す設定", url: "http://localhost:8093/009/cgi-htaccess/whoami.cgi",
    desc: "同上 + .htaccess の CGIPassAuth On", stack: "httpd → cgi",
    basis: "CGIPassAuth の Context は directory と .htaccess（Override: AuthConfig）",
  },
  {
    id: "P9", kind: "既定", url: "http://localhost:8093/009/fpm/whoami",
    desc: "Apache mod_proxy_fcgi → PHP-FPM（CGIPassAuth 既定 Off）", stack: "httpd → php-fpm",
    basis: "実行方式を CGI から FastCGI へ変えても CGIPassAuth の既定は効くか",
  },
  {
    id: "P10", kind: "直す設定", url: "http://localhost:8093/009/fpm-on/whoami",
    desc: "Apache mod_proxy_fcgi → PHP-FPM（CGIPassAuth On）", stack: "httpd → php-fpm",
    basis: "P9 が落ちる原因が CGIPassAuth の既定 Off かを切り分ける対照",
  },
];

// 🔴 対処（P6 / P7 / P8 / P10）が「いつでも yes を返すだけ」でないことを対照で確かめる。
// Authorization を付けずに同じ URL を叩き、no が返ることを検算する。
const NEGATIVE_CONTROL_IDS = ["P6", "P7", "P8", "P10"];

async function probe(url, withAuth = true) {
  const res = await fetch(url, withAuth ? { headers: { Authorization: TOKEN } } : {});
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* JSON でない応答はそのまま null */ }
  return {
    status: res.status,
    auth: body?.auth ?? null,
    scheme: body?.scheme ?? null,
    via: body?.via ?? null,
    raw: text.trim(),
  };
}

async function main() {
  // 🔴 再実行の累積を避けるため出力先を作り直す
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const lines = [
    `# ${ID} (M1)`,
    `measured-at: ${new Date().toISOString()}`,
    `node: ${process.version}`,
    "",
    `同じ Authorization を ${PATHS.length} 経路へ送り、終端に届いたかだけを読む。値そのものは記録しない。`,
    "",
  ];
  const summary = { scenario: ID, mode: "M1" };

  for (const p of PATHS) {
    const r = await probe(p.url);
    lines.push(
      `${p.id.padEnd(3)} ${p.kind.padEnd(6)} ${p.desc.padEnd(46)} ${String(p.stack).padEnd(16)} ` +
        `status=${r.status} auth=${r.auth} scheme=${r.scheme ?? "-"} via=${r.via ?? "-"}`
    );
    summary[`${p.id}_auth`] = r.auth;
    summary[`${p.id}_status`] = r.status;
    summary[`${p.id}_kind`] = p.kind;
  }

  // 🔴 対照: 対処を入れた経路が「いつでも yes」を返していないことを確かめる。
  // ここが no にならなければ測定が壊れているので、値を書き出さずに落とす。
  lines.push("", "対照（Authorization を付けずに同じ URL へ）:");
  for (const id of NEGATIVE_CONTROL_IDS) {
    const p = PATHS.find((x) => x.id === id);
    const r = await probe(p.url, false);
    lines.push(`${id.padEnd(3)} auth=${r.auth}（Authorization なし）`);
    summary[`${id}_auth_without_header`] = r.auth;
    if (r.auth !== "no") {
      throw new Error(`対照が成立しません: ${id} は Authorization なしでも auth=${r.auth} を返しました`);
    }
  }

  const dropped = PATHS.filter((p) => summary[`${p.id}_auth`] === "no").map((p) => p.id);
  const arrived = PATHS.filter((p) => summary[`${p.id}_auth`] === "yes").map((p) => p.id);
  summary.dropped_cases = dropped;
  summary.dropped_count = dropped.length;
  summary.arrived_count = arrived.length;
  summary.paths_total = PATHS.length;
  // 「設定を足さずに落ちる」構成だけを数える（P2 は落とす設定を自分で書いた側）
  // 🔴 「既定で落ちる」は kind が 既定 のものだけで数える。
  // P2 は落とす設定を自分で書いた側、P5〜P7 は落ちたあとに入れる対処。
  const defaults = PATHS.filter((p) => p.kind === "既定").map((p) => p.id);
  summary.default_cases = defaults;
  summary.dropped_by_default_cases = defaults.filter((id) => summary[`${id}_auth`] === "no");
  summary.dropped_by_default_count = summary.dropped_by_default_cases.length;
  // 落ちたあとに入れる対処のうち、実際に届いたもの
  const fixes = PATHS.filter((p) => p.kind === "直す設定").map((p) => p.id);
  summary.fix_cases = fixes;
  summary.fix_effective_cases = fixes.filter((id) => summary[`${id}_auth`] === "yes");
  summary.fix_effective_count = summary.fix_effective_cases.length;

  lines.push(
    "",
    `全 ${PATHS.length} 経路中、届いたのは ${arrived.length} 件（${arrived.join(", ")}）／落ちたのは ${dropped.length} 件（${dropped.join(", ")}）`,
    `既定の経路は ${defaults.length} 件（${defaults.join(", ")}）で、そのうち落ちたのは ${summary.dropped_by_default_count} 件（${summary.dropped_by_default_cases.join(", ") || "なし"}）`,
    `落ちたあとに入れる対処は ${fixes.length} 件（${fixes.join(", ")}）で、届いたのは ${summary.fix_effective_count} 件（${summary.fix_effective_cases.join(", ") || "なし"}）`
  );

  writeFileSync(join(OUT, "run.log"), lines.join("\n") + "\n");
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(lines.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
