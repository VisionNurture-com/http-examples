#!/usr/bin/env node
// capture-002-browser.mjs — ブラウザが実際に送るヘッダ集合を採る（M2・CI では回らない）
//
// 記事 002 の出発点は「DevTools からコピーしたのに動かない」です。その「コピー元」を
// 推測ではなく実測で取ります。採り方は単純で、受け取ったヘッダをそのまま返す口
// （/002/api/echo）へ素のナビゲーションを 1 回投げ、返ってきた JSON を保存します。
//
// 🔴 サーバ側で受け取ったものを記録します。ブラウザの API から自分の送信ヘッダを
//    完全に列挙する手段はなく、DevTools の表示も再構成された値を含むためです。
//
// 🔴 nginx を経由した口で採ります（EDGE）。hop-by-hop のヘッダは中継で消えるため、
//    「アプリに届いた集合」と「ブラウザが出した集合」は同じではありません。この差は
//    002-upgrade の観測対象そのものなので、ここでは経路を固定して記録だけ残します。
//
// 使い方: node tools/capture-002-browser.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const EDGE = "http://localhost:8087";
const OUT = join(ROOT, "results", "002-minimize");

const ENGINES = { chromium, firefox, webkit };

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const versions = {};

  for (const [name, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    const version = browser.version();
    const page = await browser.newPage();

    const res = await page.goto(`${EDGE}/002/api/echo`, { waitUntil: "load" });
    const seen = JSON.parse(await res.text());
    await browser.close();

    // 素のナビゲーションで届いた集合。Host は nginx が書き換えるため、
    // 「ブラウザが出した値」ではなく「アプリに届いた値」であることを記録に残す。
    const record = {
      browser: name,
      version,
      note: "nginx 経由で /002/api/echo に届いた集合。hop-by-hop は中継で消える",
      headerCount: Object.keys(seen.headers).length,
      headers: seen.headers,
      rawHeaderOrder: seen.rawHeaderOrder,
    };
    versions[name] = version;
    writeFileSync(join(OUT, `browser.${name}.json`), JSON.stringify(record, null, 2) + "\n");
    console.log(`[${name}] ${version} — ${record.headerCount} 本: ${Object.keys(seen.headers).join(", ")}`);
  }

  writeFileSync(join(OUT, "browsers.json"), JSON.stringify(versions, null, 2) + "\n");
  console.log(`\n採取結果を results/002-minimize/ に書きました`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
