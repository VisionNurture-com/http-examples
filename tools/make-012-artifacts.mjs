#!/usr/bin/env node
// make-012-artifacts.mjs — 記事 012 の配信物を作る（M0・docker 不要・ネットワーク不要）
//
// 作るもの（public/012/ 配下・いずれも生成物で .gitignore 済み）:
//   bundle-v2.js.gz  / .br / .zst   … 辞書なしの圧縮
//   bundle-v2.js.dcb / .dcz         … bundle-v1.js を辞書にした差分圧縮（RFC 9842）
//
// RFC 9842 の framing（§4 / §5）:
//   dcb = 0xff 0x44 0x43 0x42                     + SHA-256(辞書) 32 バイト + Shared Brotli stream
//   dcz = 0x5e 0x2a 0x4d 0x18 0x20 0x00 0x00 0x00 + SHA-256(辞書) 32 バイト + Zstandard stream
//
// 🔴 ハッシュは「辞書ファイルの中身」の SHA-256。ブラウザが Available-Dictionary で
//    送ってくる値と 1 バイトでも違えば、サーバが正しい差分を返しても復号できない。
//
// 使い方: node tools/make-012-artifacts.mjs
// 出力  : results/012-dictionary/sizes.json（生ログ）

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync, brotliCompressSync, zstdCompressSync, constants } from "node:zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const PUB = join(ROOT, "public", "012");
const OUT_DIR = join(ROOT, "results", "012-dictionary");

const DICT = join(PUB, "bundle-v1.js");
const TARGET = join(PUB, "bundle-v2.js");

const dict = readFileSync(DICT);
const target = readFileSync(TARGET);
const dictHash = createHash("sha256").update(dict).digest();

const DCB_MAGIC = Buffer.from([0xff, 0x44, 0x43, 0x42]);
const DCZ_MAGIC = Buffer.from([0x5e, 0x2a, 0x4d, 0x18, 0x20, 0x00, 0x00, 0x00]);

/** CLI を通して stdout をバイナリで受け取る（node:zlib は辞書付き brotli/zstd を出せない）*/
function run(cmd, args, input) {
  return execFileSync(cmd, args, { input, maxBuffer: 1 << 28 });
}

function version(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split("\n")[0]
      .trim();
  } catch {
    return "(取得できませんでした)";
  }
}

// --- 辞書なし（比較の対照）---
const gz = gzipSync(target, { level: constants.Z_BEST_COMPRESSION });
const br = brotliCompressSync(target, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: target.length },
});
const zst = zstdCompressSync(target, { params: { [constants.ZSTD_c_compressionLevel]: 19 } });

// --- 辞書あり（RFC 9842）---
const brDict = run("brotli", ["-q", "11", "-D", DICT, "-c"], target);
const zstDict = run("zstd", ["-19", "-D", DICT, "-c", "--no-progress"], target);

const dcb = Buffer.concat([DCB_MAGIC, dictHash, brDict]);
const dcz = Buffer.concat([DCZ_MAGIC, dictHash, zstDict]);

writeFileSync(join(PUB, "bundle-v2.js.gz"), gz);
writeFileSync(join(PUB, "bundle-v2.js.br"), br);
writeFileSync(join(PUB, "bundle-v2.js.zst"), zst);
writeFileSync(join(PUB, "bundle-v2.js.dcb"), dcb);
writeFileSync(join(PUB, "bundle-v2.js.dcz"), dcz);

const sizes = {
  generatedAt: new Date().toISOString(),
  tools: {
    node: process.version,
    brotliCli: version("brotli", ["--version"]),
    zstdCli: version("zstd", ["--version"]),
  },
  dictionary: {
    file: "public/012/bundle-v1.js",
    bytes: dict.length,
    sha256Base64: dictHash.toString("base64"),
    sha256Hex: dictHash.toString("hex"),
  },
  target: { file: "public/012/bundle-v2.js", bytes: target.length },
  encodings: {
    identity: { bytes: target.length, dictionary: false },
    gzip: { bytes: gz.length, dictionary: false },
    br: { bytes: br.length, dictionary: false },
    zstd: { bytes: zst.length, dictionary: false },
    dcb: { bytes: dcb.length, dictionary: true, payloadBytes: brDict.length, headerBytes: 36 },
    dcz: { bytes: dcz.length, dictionary: true, payloadBytes: zstDict.length, headerBytes: 40 },
  },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "sizes.json"), JSON.stringify(sizes, null, 2) + "\n");

// 生ログ。以降の measure-012-dictionary.mjs が同じファイルへ 1 行ずつ足す
writeFileSync(
  join(OUT_DIR, "run.log"),
  [
    `measured-at: ${sizes.generatedAt}`,
    `scenario: 012-dictionary`,
    `mode: M2`,
    `judgement: 圧縮方式ごとのバイト数と、実ブラウザが辞書を使ったかどうか`,
    `---`,
    JSON.stringify({ step: "sizes", ...sizes }),
    "",
  ].join("\n")
);

const rows = Object.entries(sizes.encodings);
const base = target.length;
console.log(`辞書 : public/012/bundle-v1.js  ${dict.length} バイト`);
console.log(`       SHA-256(base64) = ${sizes.dictionary.sha256Base64}`);
console.log(`対象 : public/012/bundle-v2.js  ${target.length} バイト\n`);
console.log("encoding   バイト      対 identity   辞書");
for (const [name, v] of rows) {
  const pct = ((v.bytes / base) * 100).toFixed(2).padStart(6);
  console.log(
    `${name.padEnd(10)} ${String(v.bytes).padStart(8)}   ${pct}%      ${v.dictionary ? "あり" : "なし"}`
  );
}
console.log(`\n生ログ: results/012-dictionary/sizes.json`);
