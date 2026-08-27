#!/usr/bin/env node
// measure-012-vary.mjs — Vary を落とすと共有キャッシュが何を配るか（M1・docker が要る）
//
// 🔴 説明ではなく**再現**にする。前段に proxy_cache を置き、
//    「辞書を持つ客 → 持たない客」の順で同じ URL を叩いて、2 人目が受け取った本文を検査する。
//
// 🔴 判定は「復号できたか」ではなく **「受け取ったバイト列が元のファイルと一致するか」** で取る。
//    復号できるかどうかはクライアント実装の親切さに左右される。バイト列の一致は左右されない。
//
// 前提: docker compose up -d --wait && node tools/make-012-artifacts.mjs
// 使い方: node tools/measure-012-vary.mjs
// 出力  : results/012-vary/{run.log,summary.json}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "results", "012-vary");
const BASE = "https://localhost:8448";

const original = readFileSync(join(ROOT, "public", "012", "bundle-v2.js"));
const originalSha = createHash("sha256").update(original).digest("hex");
const DICT_HASH = ":fG6CMH4IkZ0KlMuIGGZxW3pNaBRrugvU30I+ppRPaIA=:";

/** curl で 1 回叩き、ヘッダと本文を別々に受け取る */
function fetchOnce(path, { withDictionary }) {
  const headerFile = "/tmp/012-vary-headers.txt";
  const args = ["-sS", "-k", "-D", headerFile, "-o", "-", "--http1.1"];
  if (withDictionary) {
    args.push("-H", "Accept-Encoding: gzip, br, zstd, dcb, dcz", "-H", `Available-Dictionary: ${DICT_HASH}`);
  } else {
    // 辞書を持たない普通の客。dcb / dcz は受け入れると言っていない
    args.push("-H", "Accept-Encoding: gzip, br, zstd");
  }
  args.push(`${BASE}${path}`);
  const body = execFileSync("curl", args, { maxBuffer: 1 << 28 });
  const headers = readFileSync(headerFile, "utf8");
  const get = (name) => headers.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? null;
  return {
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
    contentEncoding: get("content-encoding"),
    cacheStatus: get("x-cache-status"),
    servedFile: get("x-served-file"),
    vary: get("vary"),
    matchesOriginal: createHash("sha256").update(body).digest("hex") === originalSha,
  };
}

// キャッシュを分けるため、経路ごとに URL を変える（前の試行の状態を持ち込まない）
const stamp = process.env.VARY_RUN_ID ?? "run1";

const cases = [];
for (const variant of ["novary", "withvary"]) {
  const path = `/012/${variant}.js?case=${stamp}`;
  // 1 人目: 辞書を持つ客。ここでキャッシュへ入る
  const first = fetchOnce(path, { withDictionary: true });
  // 2 人目: 辞書を持たない普通の客。同じ URL
  const second = fetchOnce(path, { withDictionary: false });
  cases.push({ variant, path, first, second });
}

const novary = cases.find((c) => c.variant === "novary");
const withvary = cases.find((c) => c.variant === "withvary");

const summary = {
  scenario: "012-vary",
  mode: "M1",
  generatedAt: new Date(0).toISOString(),
  original_bytes: original.length,
  original_sha256: originalSha,
  cases,
  // 🔴 記事が主張するのはこの 2 つ
  novary_second_client_broken: Boolean(
    novary && !novary.second.matchesOriginal && novary.second.bytes < original.length
  ),
  withvary_second_client_ok: Boolean(withvary && withvary.second.matchesOriginal),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(
  join(OUT_DIR, "run.log"),
  [
    `measured-at: ${summary.generatedAt}`,
    `scenario: 012-vary`,
    `mode: M1`,
    `judgement: 2 人目が受け取ったバイト列が元のファイルと一致するか（復号可否では判定しない）`,
    `---`,
    JSON.stringify({ original_bytes: original.length, original_sha256: originalSha }),
    ...cases.map((c) => JSON.stringify(c)),
    "",
  ].join("\n")
);

for (const c of cases) {
  console.log(`\n=== ${c.variant} ===`);
  for (const [who, r] of [["1 人目（辞書あり）", c.first], ["2 人目（辞書なし）", c.second]]) {
    console.log(
      `  ${who}: ${String(r.bytes).padStart(7)} バイト / CE=${r.contentEncoding ?? "なし"} / ` +
        `cache=${r.cacheStatus} / Vary=${r.vary ?? "なし"} / 元ファイルと一致=${r.matchesOriginal ? "はい" : "いいえ"}`
    );
  }
}
console.log(`\n2 人目が壊れた本文を受け取ったか（Vary なし）: ${summary.novary_second_client_broken}`);
console.log(`2 人目が正しい本文を受け取ったか（Vary あり）: ${summary.withvary_second_client_ok}`);
console.log(`生ログ: results/012-vary/run.log`);
