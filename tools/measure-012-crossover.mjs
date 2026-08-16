#!/usr/bin/env node
// measure-012-crossover.mjs — 辞書がいつまで効くかを測る（M0・docker 不要・ネットワーク不要）
//
// 測るもの:
//   「配布済みの版」と「次の版」がどれだけ違うと、辞書ありの差分（dcb / dcz）が
//   辞書なしの圧縮（br / zstd）に追い抜かれるか。
//
// 🔴 45 倍という数字は「差分が小さいとき」の値でしかない。単独で出すと
//    読者は自分の条件に当てはめられない。変更率を振って、効かなくなる点まで測る。
//
// 変更のモデル: v1 を行単位で見て、先頭から一定割合の行を別の行へ置き換える。
//   実際のデプロイの差分と同じではない。あくまで「どれだけ違うか」の目盛りとして使う。
//   🔴 この限界は記事にも書くこと。
//
// 使い方: node tools/measure-012-crossover.mjs
// 出力  : results/012-crossover/{run.log,summary.json}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync, brotliCompressSync, zstdCompressSync, constants } from "node:zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const PUB = join(ROOT, "public", "012");
const OUT_DIR = join(ROOT, "results", "012-crossover");
const DICT = join(PUB, "bundle-v1.js");

const RATIOS = [0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1];

const dictText = readFileSync(DICT, "utf8");
const dictBuf = readFileSync(DICT);
const lines = dictText.split("\n");

/**
 * 先頭から ratio ぶんの行を、辞書に無い内容へ置き換える。
 *
 * 🔴 置換行は元の行と同じくらいの長さにする。長い行で置き換えると
 *    変更率を上げるほどファイル自体が太り、「差分が大きいから負けた」のか
 *    「ファイルが大きいから負けた」のか分けられなくなる。
 */
function makeVariant(ratio) {
  const n = Math.round(lines.length * ratio);
  const out = lines.slice();
  for (let i = 0; i < n; i++) {
    const want = Buffer.byteLength(lines[i], "utf8");
    let s = `const g${i}=${(i * 2654435761) % 1000003};`;
    // 元の行の長さへ寄せる。埋め草も行ごとに変えて、置換行どうしが似すぎないようにする
    let k = 0;
    while (Buffer.byteLength(s, "utf8") < want) s += `/*${i}:${k++}*/`;
    out[i] = s.slice(0, Math.max(want, 1));
  }
  return Buffer.from(out.join("\n"), "utf8");
}

function brotli(buf, dict) {
  const args = ["-q", "11", "-c"];
  if (dict) args.splice(2, 0, "-D", dict);
  return execFileSync("brotli", args, { input: buf, maxBuffer: 1 << 28 });
}

function zstd(buf, dict) {
  const args = ["-19", "-c", "--no-progress"];
  if (dict) args.splice(1, 0, "-D", dict);
  return execFileSync("zstd", args, { input: buf, maxBuffer: 1 << 28 });
}

const rows = [];
for (const ratio of RATIOS) {
  const target = makeVariant(ratio);
  const gz = gzipSync(target, { level: constants.Z_BEST_COMPRESSION });
  const br = brotliCompressSync(target, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: target.length },
  });
  const zst = zstdCompressSync(target, { params: { [constants.ZSTD_c_compressionLevel]: 19 } });
  // 差分側は RFC 9842 の固定ヘッダぶん（dcb=36 / dcz=40 バイト）を足して比べる
  const dcb = brotli(target, DICT).length + 36;
  const dcz = zstd(target, DICT).length + 40;

  rows.push({
    changed_ratio: ratio,
    changed_lines: Math.round(lines.length * ratio),
    identity: target.length,
    gzip: gz.length,
    br: br.length,
    zstd: zst.length,
    dcb,
    dcz,
    dcb_vs_br: Number((dcb / br.length).toFixed(4)),
    dcz_vs_zstd: Number((dcz / zst.length).toFixed(4)),
  });
}

// 追い抜かれる点 = 辞書ありが辞書なしより大きくなる最初の変更率
const crossoverBr = rows.find((r) => r.dcb >= r.br)?.changed_ratio ?? null;
const crossoverZstd = rows.find((r) => r.dcz >= r.zstd)?.changed_ratio ?? null;

const summary = {
  scenario: "012-crossover",
  mode: "M0",
  generatedAt: new Date().toISOString(),
  dictionary_bytes: dictBuf.length,
  dictionary_lines: lines.length,
  model: "v1 の先頭から一定割合の行を辞書に無い内容へ置き換える（実デプロイの差分そのものではない）",
  ratios: RATIOS,
  rows,
  crossover_ratio_dcb_over_br: crossoverBr,
  crossover_ratio_dcz_over_zstd: crossoverZstd,
  // 変更率 100%（辞書に 1 行も残らない）でも差分側が勝ち続けるかどうか
  dcb_still_smaller_at_full_change: rows.at(-1).dcb < rows.at(-1).br,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(
  join(OUT_DIR, "run.log"),
  [
    `measured-at: ${summary.generatedAt}`,
    `scenario: 012-crossover`,
    `mode: M0`,
    `judgement: 変更率を振り、辞書あり（dcb/dcz）が辞書なし（br/zstd）を上回る点を探す`,
    `---`,
    ...rows.map((r) => JSON.stringify(r)),
    "",
  ].join("\n")
);

console.log("変更率   変更行数    identity     gzip       br      zstd       dcb       dcz   dcb/br");
for (const r of rows) {
  console.log(
    `${(r.changed_ratio * 100).toFixed(0).padStart(5)}% ${String(r.changed_lines).padStart(9)} ` +
      `${String(r.identity).padStart(11)} ${String(r.gzip).padStart(8)} ${String(r.br).padStart(8)} ` +
      `${String(r.zstd).padStart(9)} ${String(r.dcb).padStart(9)} ${String(r.dcz).padStart(9)} ` +
      `${r.dcb_vs_br.toFixed(3).padStart(7)}`
  );
}
console.log(`\ndcb が br に追い抜かれる変更率: ${crossoverBr === null ? "この範囲では無し" : crossoverBr}`);
console.log(`dcz が zstd に追い抜かれる変更率: ${crossoverZstd === null ? "この範囲では無し" : crossoverZstd}`);
console.log(`生ログ: results/012-crossover/run.log`);
