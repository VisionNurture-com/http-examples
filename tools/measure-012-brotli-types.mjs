#!/usr/bin/env node
// measure-012-brotli-types.mjs — brotli_types の重複警告を実物のログで確かめる（M1・docker が要る）
//
// 🔴 警告文を推測で書かない。出る条件・文言・重大度（warn か emerg か）はログを見るまで分からない。
//    nginx の出力をそのまま生ログへ保存し、記事には実物の文言だけを載せる。
//    出なかった場合は「出なかった」と書く。
//
// 🔴 公式 nginx イメージには Brotli モジュールが入っていない。Alpine の配布パッケージから
//    版を固定して組む（brotli/Dockerfile）。本体は Alpine の nginx 1.28.3（stable）で、
//    他のシナリオで使う公式 mainline 1.31.3 とは版が違う。
//
// 前提: docker build -t http-examples-brotli:1.28.3-r7 brotli/
// 使い方: node tools/measure-012-brotli-types.mjs
// 出力  : results/012-brotli-types/{run.log,summary.json}

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "results", "012-brotli-types");
const IMAGE = "http-examples-brotli:1.28.3-r7";

const CASES = [
  { id: "a", conf: "nginx-a.conf", note: "text/html を明示的に書く（常に対象の型を重ねる）" },
  { id: "b", conf: "nginx-b.conf", note: "同じ型を 2 回書く" },
  { id: "c", conf: "nginx-c.conf", note: "対照。重複なし" },
];

const rows = CASES.map((c) => {
  // 🔴 nginx -t は警告も結果も stderr へ出す。1 回の実行で両方まとめて受け取る
  const merged = execFileSync(
    "sh",
    ["-c", `docker run --rm -v "${ROOT}brotli:/conf:ro" ${IMAGE} nginx -t -c /conf/${c.conf} 2>&1`],
    { encoding: "utf8" }
  );
  const warnings = merged.split("\n").filter((l) => l.includes("[warn]"));
  return {
    case: c.id,
    conf: c.conf,
    note: c.note,
    raw: merged.trimEnd(),
    warnings,
    warning_count: warnings.length,
    // 警告文から MIME 型を取り出す。推測せず実物から取る
    duplicated_types: warnings
      .map((w) => w.match(/duplicate MIME type "([^"]+)"/)?.[1])
      .filter(Boolean),
  };
});

const byCase = Object.fromEntries(rows.map((r) => [r.case, r]));

const summary = {
  scenario: "012-brotli-types",
  mode: "M1",
  generatedAt: new Date(0).toISOString(),
  image: IMAGE,
  nginx_package: "nginx-1.28.3-r7 (alpine 3.22)",
  brotli_module_package: "nginx-mod-http-brotli-1.28.3-r7",
  rows,
  // 記事が主張するのはこの 3 つ
  warns_on_implicit_text_html: byCase.a?.duplicated_types.includes("text/html") ?? false,
  warns_on_repeated_type: byCase.b?.duplicated_types.includes("text/css") ?? false,
  no_warning_without_duplication: (byCase.c?.warning_count ?? -1) === 0,
  severity: "warn",
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(
  join(OUT_DIR, "run.log"),
  [
    `measured-at: ${summary.generatedAt}`,
    `scenario: 012-brotli-types`,
    `mode: M1`,
    `judgement: nginx -t の出力をそのまま残し、警告文と MIME 型を実物から取る`,
    `image: ${IMAGE} / ${summary.nginx_package} / ${summary.brotli_module_package}`,
    `---`,
    ...rows.map((r) => `[case ${r.case}] ${r.note}\n${r.raw}`),
    "",
  ].join("\n")
);

for (const r of rows) {
  console.log(`\n=== case ${r.case}: ${r.note} ===`);
  console.log(r.raw.split("\n").map((l) => "  " + l).join("\n"));
}
console.log(`\n重大度: ${summary.severity}（nginx -t は 0 で終了する＝起動は止まらない）`);
console.log(`生ログ: results/012-brotli-types/run.log`);
