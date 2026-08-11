#!/usr/bin/env node
// measure-006-headers.mjs — サーバが実際に出すヘッダを測る（M1・curl 相当・CI で回る）
//
// 測るもの:
//   006-expires-directive … expires の値ごとに何が出るか（カード②の土台）
//   006-expires-conflict  … expires と add_header Cache-Control を併用したとき何が起きるか
//   006-etag              … ETag の有無で条件付き要求の結末が変わるか
//   006-proxy-cache       … 共有キャッシュが private をどう扱うか
//
// 🔴 Cache-Control が 2 行出る可能性があるため、ヘッダは「最後の 1 本」ではなく
//    出現した全行を順番どおり配列で記録する。1 本に潰すと競合そのものが消える。

import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = "http://localhost:8084";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

/** ヘッダを全行そのまま取る。同名ヘッダが複数あってもまとめない。 */
function head(path, extraArgs = []) {
  const out = execFileSync("curl", ["-sS", "-D", "-", "-o", "/dev/null", ...extraArgs, `${BASE}${path}`], {
    encoding: "utf8",
  });
  const lines = out.split(/\r?\n/).filter(Boolean);
  const status = Number((lines[0].match(/\s(\d{3})\s/) || [])[1] ?? 0);
  const headers = lines.slice(1).map((l) => {
    const i = l.indexOf(":");
    return { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
  });
  const pick = (n) => headers.filter((h) => h.name.toLowerCase() === n).map((h) => h.value);
  return { status, cache_control: pick("cache-control"), expires: pick("expires"), etag: pick("etag"),
           last_modified: pick("last-modified"), x_parent: pick("x-parent"), x_child: pick("x-child"),
           x_cache_status: pick("x-cache-status"), all: headers.map((h) => `${h.name}: ${h.value}`) };
}

const SCENARIOS = {
  "006-expires-directive": () => {
    const cases = [
      ["expires 1h", "/006/exp/expires-only.css"],
      ["expires max", "/006/exp/max.css"],
      ["expires -1", "/006/exp/minus.css"],
      ["expires epoch", "/006/exp/epoch.css"],
      ["expires off", "/006/exp/off.css"],
      ["expires 1h + 500 応答", "/006/exp/error.css"],
    ];
    return cases.map(([label, p]) => {
      const r = head(`${p}?sc=expdir`);
      return { case: label, path: p, status: r.status, cache_control: r.cache_control, expires: r.expires };
    });
  },

  "006-expires-conflict": () => {
    const cases = [
      ["expires のみ", "/006/exp/expires-only.css"],
      ["add_header のみ", "/006/exp/addheader-only.css"],
      ["両方（expires → add_header の順に書く）", "/006/exp/both.css"],
      ["両方（add_header → expires の順に書く）", "/006/exp/both-reverse.css"],
      ["入れ子・子が自前の add_header を持つ", "/006/exp/nest/child-own.css"],
      ["入れ子・子が add_header を持たない", "/006/exp/nest/child-none.css"],
    ];
    return cases.map(([label, p]) => {
      const r = head(`${p}?sc=expconf`);
      return {
        case: label, path: p, status: r.status,
        cache_control: r.cache_control,
        cache_control_count: r.cache_control.length,
        expires: r.expires,
        x_parent: r.x_parent, x_child: r.x_child,
      };
    });
  },

  "006-etag": () => {
    const rows = [];
    for (const [label, p] of [["ETag あり", "/006/etag/on.css"], ["ETag なし", "/006/etag/off.css"]]) {
      const first = head(`${p}?sc=etag`);
      // 1 回目で得た検証子を使って条件付き要求を出す
      const extra = first.etag[0] ? ["-H", `If-None-Match: ${first.etag[0]}`] : [];
      const second = head(`${p}?sc=etag`, extra);
      rows.push({
        case: label, path: p,
        first_status: first.status,
        etag: first.etag, last_modified: first.last_modified,
        cache_control: first.cache_control,
        conditional_sent: extra.length > 0,
        second_status: second.status,
      });
    }
    return rows;
  },

  "006-proxy-cache": () => {
    const rows = [];
    for (const [label, cc] of [
      ["public, max-age=60", "public, max-age=60"],
      ["private, max-age=60", "private, max-age=60"],
      ["no-store", "no-store"],
      ["指定なし", ""],
    ]) {
      const k = `k${Math.abs(hash(cc))}`;
      // 同じ URL を 2 回叩く。2 回目が共有キャッシュに当たれば上流には届かない。
      const q = `?sc=pcache&k=${k}${cc ? `&cc=${encodeURIComponent(cc)}` : ""}`;
      const first = head(`/006/shared/r${q}`);
      const second = head(`/006/shared/r${q}`);
      const hits = JSON.parse(
        execFileSync("curl", ["-sS", `${BASE}/006/api/hits?k=${k}`], { encoding: "utf8" })
      );
      rows.push({
        case: label, upstream_cache_control: cc || null,
        first_cache_status: first.x_cache_status, second_cache_status: second.x_cache_status,
        upstream_hits: hits.upstreamHits,
        stored_by_shared_cache: hits.upstreamHits === 1,
      });
    }
    return rows;
  },
};

/** ケース識別子を安定させるための素朴なハッシュ（衝突しても測定に影響しない） */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function main() {
  const scenario = String(args.scenario ?? "");
  const fn = SCENARIOS[scenario];
  if (!fn) {
    console.error(`unknown --scenario: ${scenario}（${Object.keys(SCENARIOS).join(" / ")}）`);
    process.exit(3);
  }
  const OUT = join(ROOT, "results", scenario);
  mkdirSync(OUT, { recursive: true });

  appendFileSync(
    join(OUT, "run.log"),
    [
      `measured-at: ${new Date().toISOString()}`,
      `scenario: ${scenario}`,
      "mode: M1",
      `base: ${BASE}`,
      "judgement: curl が受け取ったヘッダ全行（同名ヘッダをまとめない）",
      "---",
    ].join("\n") + "\n"
  );

  const rows = fn();
  for (const r of rows) {
    appendFileSync(join(OUT, "run.log"), JSON.stringify(r) + "\n");
    console.log(JSON.stringify(r));
  }
  writeFileSync(join(OUT, "raw.json"), JSON.stringify(rows, null, 2) + "\n");
  console.log(`\n${rows.length} 件を results/${scenario}/raw.json に保存しました。`);
}

main();
