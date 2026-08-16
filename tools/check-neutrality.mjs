#!/usr/bin/env node
// check-neutrality.mjs — 公開移管を壊す混入の検出（M0・docker 不要・ネットワーク不要）
//
// 本リポジトリは検証用（private）で書き、中立化してから公開用（public）へ移す。
// 移管時の手作業だけに頼ると、27 シナリオ分の実測ログに紛れた混入を見落とす。
//
// 検出するもの（いずれも「誰の環境で測ったか」が残る典型）:
//   - 絶対パス /Users/<name>/ や /home/<name>/
//   - *.local のホスト名（macOS の既定ホスト名）
//   - mkcert が証明書へ埋める開発者名（issuer / subject をログに取り込むと入る）
//   - 実在メールアドレス（example.com / example.test は除く）
//
// 🔴 個人名そのものはこのスクリプトに書かない。書けばそれ自体が混入になる。
//    形（パターン）で捕まえる。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const SKIP_DIRS = new Set([".git", "node_modules", "certs"]);
const SKIP_FILES = new Set(["check-neutrality.mjs", "package-lock.json"]);

// 各環境の既定アカウント名は「誰の環境か」を示さないため除外する。
// 例: Multipass の ubuntu / GitHub Actions の runner / コンテナの root・node。
const NEUTRAL_ACCOUNTS = ["ubuntu", "root", "runner", "node", "user", "app", "alice", "bob"];

// 公開が前提のアドレスは対象外にする。
// 本検出器が捕まえたいのは「誰の環境で測ったか」が残る情報であって、
// 公開物に載ることが決まっている発行者のアドレスではない。
// blog@techbizplusd.com は公開用コミットの author / committer として
// 全コミットのメタデータに載るため、隠す対象になりえない
// （.github/workflows/verify.yml の identity ジョブが期待値として持つ）。
const PUBLIC_ADDRESSES = ["blog@techbizplusd.com"];

const PATTERNS = [
  {
    name: "ホームディレクトリの絶対パス",
    re: new RegExp(`/(?:Users|home)/(?!(?:${NEUTRAL_ACCOUNTS.join("|")})/)[A-Za-z0-9._-]+/`),
  },
  { name: "*.local のホスト名", re: /\b[A-Za-z0-9-]+\.local\b/ },
  { name: "mkcert の開発者名（証明書の issuer / subject）", re: /mkcert (?:development|[A-Za-z0-9._-]+@)/ },
  {
    name: "実在しうるメールアドレス",
    re: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|test|org)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    // 🔴 除外は「その行に公開前提のアドレスしか無いとき」に限る。
    //    行に別のアドレスが混ざっていれば、そちらは従来どおり検出する。
    allow: (hit, line) =>
      PUBLIC_ADDRESSES.includes(hit) &&
      (line.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) ?? []).every((a) =>
        PUBLIC_ADDRESSES.includes(a),
      ),
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (!SKIP_FILES.has(entry)) out.push(p);
  }
  return out;
}

function isProbablyText(buf) {
  return !buf.includes(0);
}

function main() {
  console.log("==========================================");
  console.log("check-neutrality (M0)");
  console.log("==========================================");

  const hits = [];
  const files = walk(ROOT);

  for (const file of files) {
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      continue;
    }
    if (!isProbablyText(buf)) continue;
    const lines = buf.toString("utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { name, re, allow } of PATTERNS) {
        const m = line.match(re);
        if (!m) continue;
        if (allow && allow(m[0], line)) continue;
        hits.push({ file: relative(ROOT, file), line: i + 1, name, sample: m[0] });
      }
    });
  }

  console.log(`検査したファイル ${files.length} 件`);

  if (hits.length > 0) {
    console.log("");
    for (const h of hits) {
      console.log(`❌ ${h.file}:${h.line} — ${h.name}（${h.sample}）`);
    }
    console.log(`\n❌ FAIL [check-neutrality] ${hits.length} 件`);
    console.log("   公開用リポジトリへ移す前に取り除いてください。");
    return 1;
  }

  console.log("\n✅ PASS [check-neutrality] 環境固有の情報の混入はありません");
  return 0;
}

process.exit(main());
