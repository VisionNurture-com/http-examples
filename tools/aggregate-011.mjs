#!/usr/bin/env node
// aggregate-011.mjs — 011（HTTP/3）の M3 生ログを記事に載せる表へ畳む
//
// 🔴 予測は入れない。crossover-*.jsonl / mux-*.jsonl に実際に記録された値だけを使う。
//
// 集計規約（前セッションの誤りを繰り返さないための取り決め）:
//   - タイムアウト（curl_rc≠0）を速度 0 として中央値に混ぜない。完走した回だけで中央値を出す
//   - 3 回中 k 回しか完走しなければ (k/3) を付す。1 回も完走しなければ TIMEOUT
//   - 実効 RTT は設定値でなくログに記録された実測値を併記する
//   - プロトコルを分けて回した回（ファイル名の -h1 / -h2 / -h3 / -tcp）は同じ条件へ束ねる
//
// 使い方: node tools/aggregate-011.mjs [crossover|mux|offload|control]（省略時は全部）

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "results/011-protocol");
const PROTOS = ["http1.1", "http2", "http3-only"];

const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const readJsonl = (f) =>
  readFileSync(join(DIR, f), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

/** ファイル名から nginx の http3_stream_buffer_size を読む。
 *  反復測定（-rep2）は別の行として残す。混ぜると過去に記事へ出した値が黙って動くため。 */
function settingOf(name) {
  const buf = name.includes("buf4m")
    ? "4m"
    : name.includes("buf1m")
      ? "1m"
      : name.includes("buf256k")
        ? "256k"
        : "64k"; // 既定（ディレクティブを書かない状態）
  const rep = name.match(/-rep(\d+)/);
  return rep ? `${buf}(rep${rep[1]})` : buf;
}

const files = readdirSync(DIR);

/** 1 セル分の表示。完走数を必ず併記する */
function cell(runs) {
  const ok = runs.filter((r) => r.curl_rc === 0 && r.m.size > 0);
  if (ok.length === 0) return "TIMEOUT";
  const mbps = median(ok.map((r) => (r.m.speed_bps * 8) / 1e6));
  const s = mbps < 100 ? mbps.toFixed(1) : mbps.toFixed(0);
  return ok.length === runs.length ? s : `${s} (${ok.length}/${runs.length})`;
}

function crossoverGroups(labels) {
  const g = new Map();
  // オフロード比較は buffer=4m 固定の別実験。ファイル名に設定が入らないので、この表からは外す
  const target = files.filter(
    (f) => f.startsWith("crossover-") && f.endsWith(".jsonl") && !f.includes("offload")
  );
  for (const f of target) {
    const setting = settingOf(f);
    for (const r of readJsonl(f)) {
      if (labels && !labels.includes(r.label)) continue;
      const key = [r.label, r.rate, r.rtt_set_ms, r.loss, setting].join("|");
      if (!g.has(key)) g.set(key, new Map());
      const byProto = g.get(key);
      if (!byProto.has(r.proto)) byProto.set(r.proto, []);
      byProto.get(r.proto).push(r);
    }
  }
  return g;
}

function printCrossover(labels) {
  const g = crossoverGroups(labels);
  console.log("| ラベル | 条件 | 設定 | 実効RTT min/med/p90 (ms) | h1.1 | h2 | h3 |");
  console.log("|---|---|---|---|---:|---:|---:|");
  for (const key of [...g.keys()].sort()) {
    const [label, rate, rtt, loss, setting] = key.split("|");
    const byProto = g.get(key);
    const any = [...byProto.values()][0][0];
    const e = any.rtt_eff;
    const cells = PROTOS.map((p) => (byProto.has(p) ? cell(byProto.get(p)) : "—"));
    console.log(
      `| ${label} | ${rate} / 設定${rtt}ms / loss ${loss} | ${setting} | ` +
        `${e.min.toFixed(0)} / ${e.median.toFixed(0)} / ${e.p90.toFixed(0)} | ` +
        `${cells[0]} | ${cells[1]} | **${cells[2]}** |`
    );
  }
}

/** TCP アームは http3_stream_buffer_size の影響を受けない。ここのばらつき＝測定の地面の揺れ */
function printControl() {
  const g = crossoverGroups(null);
  const rows = [];
  for (const key of [...g.keys()].sort()) {
    const [label, rate, rtt, loss, setting] = key.split("|");
    if (setting !== "64k") continue;
    const other = [label, rate, rtt, loss, "4m"].join("|");
    if (!g.has(other)) continue;
    for (const proto of ["http1.1", "http2"]) {
      const a = g.get(key).get(proto);
      const b = g.get(other).get(proto);
      if (!a || !b) continue;
      const [x, y] = [a, b].map((rs) => {
        const ok = rs.filter((r) => r.curl_rc === 0 && r.m.size > 0);
        return ok.length ? median(ok.map((r) => (r.m.speed_bps * 8) / 1e6)) : null;
      });
      if (!x || !y) continue;
      const ratio = Math.max(x, y) / Math.min(x, y);
      rows.push({ label, rtt, loss, proto, x, y, ratio });
      console.log(
        `| ${label} | 設定${rtt}ms / loss ${loss} | ${proto} | ${x.toFixed(1)} | ${y.toFixed(1)} | ${ratio.toFixed(2)} |`
      );
    }
  }
  const rs = rows.map((r) => r.ratio);
  console.log(
    `\n対照 n=${rs.length} / 比の中央値 ${median(rs).toFixed(2)} / 最大 ${Math.max(...rs).toFixed(2)}`
  );
}

// 🔴 rtt_set_ms でも分ける（2026-08-15 修正）。
// mux-64k.jsonl / mux-4m.jsonl は 20ms と 100ms を 36 行ずつ含むため、
// 従来は両者を混ぜた中央値を出しており、記事の表（100ms 条件）を再現できなかった。
// ファイル見出しの実効 RTT も rows[0] だけを見ていたため 100ms 側が誤ラベルになっていた。
function printMux() {
  for (const f of files.filter((f) => f.startsWith("mux-") && f.endsWith(".jsonl")).sort()) {
    const rows = readJsonl(f);
    console.log(`\n### ${f}（loss ${rows[0].loss ?? "0%"}）`);
    const conds = [...new Set(rows.map((r) => r.rtt_set_ms))].sort((a, b) => a - b);
    for (const rtt of conds) {
      const sub = rows.filter((r) => r.rtt_set_ms === rtt);
      const effMin = median(sub.map((r) => r.rtt_eff.min));
      const effMed = median(sub.map((r) => r.rtt_eff.median));
      console.log(
        `  [設定 ${rtt}ms / 実効RTT min ${effMin.toFixed(0)}ms・med ${effMed.toFixed(0)}ms]`
      );
      const g = new Map();
      for (const r of sub) {
        const k = `${r.objects}|${r.mode}`;
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(r.elapsed_s);
      }
      for (const k of [...g.keys()].sort((a, b) => {
        const [an, am] = a.split("|");
        const [bn, bm] = b.split("|");
        return Number(an) - Number(bn) || am.localeCompare(bm);
      })) {
        const [n, mode] = k.split("|");
        const v = g.get(k);
        console.log(
          `    N=${n.padStart(3)} ${mode.padEnd(8)} median=${median(v).toFixed(3)}s  runs=[${v.join(", ")}]`
        );
      }
    }
  }
}

function printOffload() {
  const out = new Map();
  for (const tag of ["on", "off"]) {
    for (const r of readJsonl(`crossover-T4-offload-${tag}.jsonl`)) {
      const k = `${r.proto}|${tag}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push((r.m.speed_bps * 8) / 1e6);
    }
  }
  console.log("| プロトコル | オフロード ON | OFF | ON/OFF |");
  console.log("|---|---:|---:|---:|");
  for (const p of PROTOS) {
    const on = median(out.get(`${p}|on`));
    const off = median(out.get(`${p}|off`));
    console.log(
      `| ${p} | ${on.toFixed(0)} | ${off.toFixed(0)} | ${(on / off).toFixed(2)} |`
    );
  }
}

const what = process.argv[2];
if (!what || what === "crossover") {
  console.log("## crossover（カード①・ロス率条件を含む）\n");
  printCrossover(null);
}
if (!what || what === "control") {
  console.log("\n## 対照アーム（設定が効かないはずの h1.1 / h2 の 64k ⟷ 4m 比）\n");
  console.log("| ラベル | 条件 | プロトコル | 64k | 4m | 比 |");
  console.log("|---|---|---|---:|---:|---:|");
  printControl();
}
if (!what || what === "mux") {
  console.log("\n## mux（カード②）");
  printMux();
}
if (!what || what === "offload") {
  console.log("\n## オフロード ON/OFF（無整形・100 MiB）\n");
  printOffload();
}
