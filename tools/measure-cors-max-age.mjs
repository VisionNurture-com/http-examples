#!/usr/bin/env node
// measure-cors-max-age.mjs — preflight キャッシュの実効期間を測る（M2・実ブラウザ）
//
// 測り方:
//   ページ（http://localhost:8080）から API（http://localhost:8081）へ、
//   独自ヘッダ x-probe を付けた非単純リクエストを一定間隔で投げ続ける。
//   preflight が飛んだかどうかはブラウザから観測できないため、
//   サーバ側の到着記録（results/008-cors-max-age/preflight.log）で判定する。
//
//   OPTIONS が届いた時刻の差 = そのブラウザが preflight をキャッシュしていた時間。
//
// 使い方:
//   node tools/measure-cors-max-age.mjs --browser=chromium --path=/008/maxage-2 \
//        --duration=30 --interval=1 --label=maxage-2
//
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logLineCount, assertLogChannelLive } from "./log-channel.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "results", "008-cors-max-age");
const PREFLIGHT_LOG = join(OUT, "preflight.log");
const PAGE = "http://localhost:8080/008/";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const browserName = args.browser ?? "chromium";
const path = args.path ?? "/008/maxage-default";
const duration = Number(args.duration ?? 30);
const interval = Number(args.interval ?? 1);
const label = args.label ?? path.replace(/\W+/g, "-");

const LAUNCHERS = { chromium, firefox, webkit };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** preflight.log から、指定 URI 宛の OPTIONS 到着時刻を拾う */
function readPreflightArrivals(uri) {
  if (!existsSync(PREFLIGHT_LOG)) return [];
  return readFileSync(PREFLIGHT_LOG, "utf8")
    .split("\n")
    .filter((l) => l.includes(" OPTIONS ") && l.includes(` ${uri} `))
    .map((l) => {
      const [ts] = l.split(" ");
      return { ts, epoch: Date.parse(ts) };
    })
    .filter((x) => Number.isFinite(x.epoch));
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // 観測チャネル（サーバ側の到着記録）の生死は測定の前提
  const logBefore = logLineCount(PREFLIGHT_LOG);

  const launcher = LAUNCHERS[browserName];
  if (!launcher) throw new Error(`unknown browser: ${browserName}`);

  const before = readPreflightArrivals(path).length;
  const browser = await launcher.launch();
  const version = browser.version();

  // 毎回まっさらな状態から測る。プロファイルを使い回すと前回の
  // preflight キャッシュが残り、初回の OPTIONS が観測できない。
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });

  const startedAt = new Date();
  const probes = [];
  const endAt = Date.now() + duration * 1000;

  while (Date.now() < endAt) {
    const elapsed = Math.round((Date.now() - startedAt.getTime()) / 1000);
    const r = await page.evaluate((p) => window.probe(p), path);
    probes.push({ elapsed, ok: r.ok, status: r.status ?? null });
    await sleep(interval * 1000);
  }

  await context.close();
  await browser.close();

  // 書き出す前に観測チャネルの生死を確かめる（死んでいれば到着 0 件が偽の測定値になる）
  assertLogChannelLive(PREFLIGHT_LOG, logBefore, `cors-max-age/${browserName}`);

  // サーバ側の到着記録から、この測定で増えた分だけを取り出す
  const all = readPreflightArrivals(path);
  const arrivals = all.slice(before);
  const t0 = arrivals.length ? arrivals[0].epoch : null;
  const offsets = arrivals.map((a) => Math.round((a.epoch - t0) / 1000));
  const gaps = offsets.slice(1).map((v, i) => v - offsets[i]);

  const result = {
    label,
    browser: browserName,
    browser_version: version,
    path,
    duration_s: duration,
    interval_s: interval,
    probes_sent: probes.length,
    probes_failed: probes.filter((p) => !p.ok).length,
    preflight_count: arrivals.length,
    preflight_offsets_s: offsets,
    preflight_gaps_s: gaps,
    started_at: startedAt.toISOString(),
  };

  const file = join(OUT, `${label}.${browserName}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2) + "\n");

  appendFileSync(
    join(OUT, "run.log"),
    [
      `measured-at: ${startedAt.toISOString()}`,
      `browser: ${browserName} ${version}`,
      `path: ${path}  duration=${duration}s interval=${interval}s`,
      `probes: ${probes.length} (failed ${result.probes_failed})`,
      `preflight arrivals: ${arrivals.length}  offsets(s)=[${offsets.join(", ")}]  gaps(s)=[${gaps.join(", ")}]`,
      "---",
      "",
    ].join("\n")
  );

  console.log(`[${label}/${browserName} ${version}] probes=${probes.length} preflight=${arrivals.length} gaps=[${gaps.join(", ")}]`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
