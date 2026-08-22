#!/usr/bin/env node
// measure-006-cache.mjs — Cache-Control の実効挙動を実ブラウザで測る（M2）
//
// 判定はサーバ側の到着記録（results/006-cache/access.log）で行う。
// ブラウザ内部からキャッシュ命中は覗けないため。到着の意味は 3 つに分かれる。
//
//   到着 0 件 … キャッシュから読んだ（訊きにも来ていない）
//   status=304 … 訊きに来たが本体は送っていない（条件付き要求）
//   status=200 … 取り直した
//
// 🔴 immutable の効果は「条件付き要求すら出さない」ことなので、304 と 200 を
//    区別しない判定では測れない。log_format に status を入れているのはそのため。
//
// 🔴 対照を事前条件として検査する。
//    陰性対照 plain … 2 回目の到着が 0 でなければ、そもそもキャッシュが働いていない
//    陽性対照 nostore … 2 回目が必ず到着しなければ、観測チャネルが死んでいる
//    条件付き対照 nocache … 2 回目が 304 で届かなければ、この装置は「訊きに来たこと」を
//                            そもそも観測できていない。immutable の効果は
//                            「条件付き要求を出さない」ことなので、304 を 1 件も
//                            観測できない装置での 0 件は何も意味しない。
//    いずれかが崩れた実行は測定値を書き出さずに落とす（偽の 0 件を防ぐ）。
//
// 使い方:
//   node tools/measure-006-cache.mjs --scenario=006-immutable --browser=chromium
//   node tools/measure-006-cache.mjs --scenario=006-immutable --browser=chromium --persistent
//
// 🔴 実行前に docker compose up -d --wait しておくこと。

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHARED = join(ROOT, "results", "006-cache");
const LOG = join(SHARED, "access.log");
const ORIGIN = { http: "http://localhost:8084", https: "https://localhost:8444" };
const ASSET = "/006/asset/app.css";

const LAUNCHERS = { chromium, firefox, webkit };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

// 各シナリオが振る変種と経路。対照（plain / nostore の nav）は常に足される。
const SCENARIOS = {
  "006-immutable": {
    variants: ["plain", "immutable"],
    routes: ["nav", "reload"],
    schemes: ["http", "https"],
  },
  // immutable が「まだ効く経路」が残っていないかを潰しにいく。
  // 通常ナビゲーションとリロードで差が出なかったため、fresh でなくなった後・
  // プロファイル再起動後・スクリプトから明示的に再検証した場合を足す。
  // 🔴 schemes に http を足した（2026-08-10）。Firefox が immutable を
  //    https でのみ honor する（Bugzilla 1267474）ことは、https だけ測っても言えない。
  //    「http では差が出ない」という対照が要る。それまで本シナリオは https のみで、
  //    記事が書いていた http 側の記述に対応する記録が results に無かった。
  "006-immutable-boundary": {
    variants: ["plain5", "immutable5"],
    routes: ["stale", "restart", "fetch-nocache", "fetch-reload"],
    schemes: ["http", "https"],
  },
  // カード②のブラウザ側。Cache-Control が 2 行届いたときどちらに従うかは
  // サーバ側のヘッダを見ても分からない。実際に再取得しに来るかで判定する。
  "006-expires-conflict": {
    paths: [
      { label: "expires のみ（max-age=3600）", path: "/006/exp/expires-only.css" },
      { label: "add_header のみ（no-store）", path: "/006/exp/addheader-only.css" },
      { label: "両方（2 行届く）", path: "/006/exp/both.css" },
      { label: "入れ子・親の no-store が落ちる", path: "/006/exp/nest/child-own.css" },
    ],
    routes: ["nav"],
    schemes: ["https"],
  },
  "006-contradictory": {
    variants: ["ns-max", "nc-max", "ns-nc", "conflicted", "mustrev"],
    routes: ["nav"],
    schemes: ["https"],
  },
  "006-navigation": {
    variants: ["plain", "mustrev", "nocache"],
    routes: ["nav", "reload"],
    schemes: ["https"],
  },
  // 🔴 must-revalidate の「期限が切れたあと」を測る（2026-08-11 追加）。
  //    006-contradictory は max-age=600 と併記した fresh のあいだしか見ておらず、
  //    記事は 3 か所で「期限が切れたあとの動きは測っていない」と書いていた。
  //    仕様（RFC 9111）が must-revalidate に与えている意味は stale 側にあるので、
  //    短命版（max-age=5）で境界を跨ぎ、有無だけを変えて比べる。
  "006-mustrev-boundary": {
    variants: ["plain5", "mustrev5"],
    routes: ["stale"],
    schemes: ["https"],
  },
};

function logLines() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8").split("\n").filter(Boolean);
}

/**
 * from 行目以降で、この case のアセット到着行を返す。
 *
 * アセットのパスはシナリオによって変わる（変種をクエリで振る系統と、設定の違う
 * location を叩く系統がある）ため、パスではなくケース識別子で絞る。
 * ページ自身の到着行は測定対象ではないので除く。
 */
function assetHitsSince(from, cs) {
  return logLines()
    .slice(from)
    .filter((l) => l.includes(`cs=${cs}`) && !l.includes("/006/page"));
}

function statusOf(line) {
  const m = line.match(/status=(\d{3})/);
  return m ? Number(m[1]) : null;
}

function urls(scheme, v, cs, br, rt, assetPath) {
  const base = ORIGIN[scheme];
  // アセット URL は 1 回目と 2 回目で完全に同一にする（URL がキャッシュの鍵のため）
  const asset = assetPath
    ? `${assetPath}?sc=006&cs=${cs}&br=${br}&rt=${rt}`
    : `${ASSET}?v=${v}&sc=006&cs=${cs}&br=${br}&rt=${rt}`;
  // 🔴 ページ URL は毎回変える。同一 URL への再訪が reload と解釈される余地を消すため。
  //    判定対象はアセットなので、ページ側を変えても測るものは変わらない。
  const page = (n) =>
    `${base}/006/page?asset=${encodeURIComponent(asset)}&cc=no-store&sc=006&cs=${cs}&n=${n}`;
  return { page, asset: `${base}${asset}` };
}

async function openContext(launcher, browserName, persistent) {
  if (!persistent) {
    const browser = await launcher.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    return { context, close: async () => { await context.close(); await browser.close(); } };
  }
  // 実機に近い永続プロファイルでの対照。分離コンテキストがメモリキャッシュのみに
  // なっている可能性を排除できないため、同じ値が出るかを確かめる用途に使う。
  const dir = join(SHARED, `profile-${browserName}-${Date.now()}`);
  const context = await launcher.launchPersistentContext(dir, { ignoreHTTPSErrors: true });
  return {
    context,
    close: async () => {
      await context.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** プロファイルを閉じて開き直す経路だけは、コンテキストを 2 回開く必要がある */
async function measureRestart(launcher, browserName, scheme, v, cs, pageUrl) {
  const dir = join(SHARED, `profile-restart-${browserName}-${Date.now()}`);
  const before = logLines().length;

  let ctx = await launcher.launchPersistentContext(dir, { ignoreHTTPSErrors: true });
  let page = await ctx.newPage();
  await page.goto(pageUrl(1));
  await sleep(700);
  await ctx.close();
  const mid = logLines().length;

  // 同じプロファイルで開き直す。ディスクキャッシュが残っているかを見る。
  ctx = await launcher.launchPersistentContext(dir, { ignoreHTTPSErrors: true });
  page = await ctx.newPage();
  await page.goto(pageUrl(2));
  await sleep(900);
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });

  return { before, mid };
}

async function measureCase(launcher, browserName, scheme, v, route, persistent, assetPath) {
  const cs = `${browserName}-${scheme}-${v}-${route}${persistent ? "-persist" : ""}`;
  const { page: pageUrl, asset: assetUrl } = urls(scheme, v, cs, browserName, route, assetPath);

  if (route === "restart") {
    const { before, mid } = await measureRestart(launcher, browserName, scheme, v, cs, pageUrl);
    const all = assetHitsSince(before, cs);
    const second = assetHitsSince(mid, cs);
    return {
      scenario: args.scenario, browser: browserName, scheme, variant: v, route,
      persistent: true,
      first_hits: all.length - second.length,
      second_hits: second.length,
      second_statuses: second.map(statusOf),
      silent_on_second: second.length === 0,
    };
  }

  const { context, close } = await openContext(launcher, browserName, persistent);
  const page = await context.newPage();

  const before = logLines().length;
  await page.goto(pageUrl(1));
  await sleep(700);

  // fresh でなくなってから測る経路。max-age=5 の変種と組で使う。
  if (route === "stale") await sleep(7000);

  const mid = logLines().length;

  if (route === "nav" || route === "stale") await page.goto(pageUrl(2));
  else if (route === "reload") await page.reload();
  else if (route === "fetch-nocache" || route === "fetch-reload") {
    // スクリプトから明示的に再検証を要求したとき、immutable がそれを抑えるか。
    const mode = route === "fetch-nocache" ? "no-cache" : "reload";
    await page.evaluate(
      async ({ url, mode }) => { await fetch(url, { cache: mode }); },
      { url: assetUrl, mode }
    );
  }
  await sleep(900);

  const all = assetHitsSince(before, cs);
  const second = assetHitsSince(mid, cs);
  await close();

  return {
    scenario: args.scenario,
    browser: browserName,
    scheme,
    variant: v,
    route,
    persistent: Boolean(persistent),
    first_hits: all.length - second.length,
    second_hits: second.length,
    second_statuses: second.map(statusOf),
    // 2 回目に何も届かなかった = 訊きにも来ていない
    silent_on_second: second.length === 0,
  };
}

async function main() {
  const scenario = String(args.scenario ?? "");
  const spec = SCENARIOS[scenario];
  if (!spec) {
    console.error(`unknown --scenario: ${scenario}（${Object.keys(SCENARIOS).join(" / ")}）`);
    process.exit(3);
  }
  const browserName = String(args.browser ?? "chromium");
  const launcher = LAUNCHERS[browserName];
  if (!launcher) {
    console.error(`unknown --browser: ${browserName}`);
    process.exit(3);
  }
  const persistent = Boolean(args.persistent);

  const OUT = join(ROOT, "results", scenario);
  mkdirSync(OUT, { recursive: true });
  mkdirSync(SHARED, { recursive: true });

  const RUNLOG = join(OUT, "run.log");
  appendFileSync(
    RUNLOG,
    [
      `measured-at: ${new Date().toISOString()}`,
      `scenario: ${scenario}`,
      "mode: M2",
      `browser: ${browserName} ${(await (async () => { const b = await launcher.launch(); const v = b.version(); await b.close(); return v; })())}`,
      `profile: ${persistent ? "persistent" : "isolated-context"}`,
      `judgement: サーバ側の到着記録と status（生ログのカウントのみ・予測は入れない）`,
      "---",
    ].join("\n") + "\n"
  );

  const rows = [];

  // --- 対照を先に取る。ここが崩れていれば以降の 0 件はすべて意味を持たない ---
  for (const scheme of spec.schemes) {
    for (const v of ["plain", "nostore", "nocache"]) {
      const r = await measureCase(launcher, browserName, scheme, v, "nav", persistent);
      r.control = v === "plain" ? "negative" : v === "nostore" ? "positive" : "conditional";
      rows.push(r);
      appendFileSync(RUNLOG, JSON.stringify(r) + "\n");
      console.log(
        `[対照] ${browserName} ${scheme} ${v.padEnd(9)} nav  1回目=${r.first_hits} 2回目=${r.second_hits} ${JSON.stringify(r.second_statuses)}`
      );
    }
    const neg = rows.find((r) => r.scheme === scheme && r.variant === "plain" && r.route === "nav");
    const pos = rows.find((r) => r.scheme === scheme && r.variant === "nostore" && r.route === "nav");
    if (!neg || neg.second_hits !== 0) {
      throw new Error(
        `[${scenario}/${browserName}/${scheme}] 陰性対照が崩れました: plain の 2 回目が ${neg ? neg.second_hits : "?"} 件届いています。\n` +
          "この装置ではキャッシュが働いていません（分離コンテキストや TLS 警告バイパスの影響が疑われます）。\n" +
          "以降の「到着 0 件」は測定値として意味を持たないため、書き出さずに中止しました。"
      );
    }
    if (!pos || pos.second_hits < 1) {
      throw new Error(
        `[${scenario}/${browserName}/${scheme}] 陽性対照が崩れました: no-store の 2 回目が届いていません。\n` +
          "観測チャネル（nginx のアクセスログ）が死んでいる可能性があります。\n" +
          "復旧: docker compose exec edge nginx -s reopen"
      );
    }
    const cond = rows.find((r) => r.scheme === scheme && r.variant === "nocache" && r.route === "nav");
    if (!cond || !cond.second_statuses.includes(304)) {
      throw new Error(
        `[${scenario}/${browserName}/${scheme}] 条件付き対照が崩れました: no-cache の 2 回目に 304 が観測できていません` +
          `（実測 ${JSON.stringify(cond ? cond.second_statuses : null)}）。\n` +
          "この装置は「訊きに来たこと」を観測できていないため、他の変種の「到着 0 件」を\n" +
          "「条件付き要求すら出さなかった」と読むことはできません。書き出さずに中止しました。"
      );
    }
  }

  // --- 本測定 ---
  // 変種をクエリで振るシナリオと、あらかじめ別の location を用意したパスを叩く
  // シナリオの 2 系統がある。後者は設定そのものが違うため URL を分ける必要がある。
  const units = spec.paths
    ? spec.paths.map((p, i) => ({ key: `p${i}`, label: p.label, path: p.path }))
    : spec.variants.map((v) => ({ key: v, label: v, path: null }));

  for (const scheme of spec.schemes) {
    for (const u of units) {
      for (const route of spec.routes) {
        const r = await measureCase(launcher, browserName, scheme, u.key, route, persistent, u.path);
        // 🔴 1 回目に届いていないケースは測定が成立していない。
        //    2 回目の 0 件を「キャッシュから読んだ」と読めるのは、1 回目に確かに
        //    取りに来ていたときだけ。ここを検査しないと、埋め込みに失敗しただけの
        //    ケースが「訊きにも来ない」という強い結論として出てしまう。
        if (r.first_hits < 1) {
          throw new Error(
            `[${scenario}/${browserName}/${scheme}] ${u.label} の 1 回目が 0 件です。\n` +
              `アセット（${u.path ?? ASSET}）がそもそも読み込まれていません。ページへの埋め込みに\n` +
              "失敗している可能性があります（許可リスト・パスの綴り）。測定として成立していないため中止しました。"
          );
        }
        r.label = u.label;
        if (u.path) r.asset_path = u.path;
        rows.push(r);
        appendFileSync(RUNLOG, JSON.stringify(r) + "\n");
        console.log(
          `${browserName.padEnd(9)} ${scheme.padEnd(5)} ${String(u.label).padEnd(30)} ${route.padEnd(6)} ` +
            `1回目=${r.first_hits} 2回目=${r.second_hits} ${JSON.stringify(r.second_statuses)} ` +
            `→ ${r.silent_on_second ? "訊きにも来ない" : "来た"}`
        );
      }
    }
  }

  const suffix = persistent ? `${browserName}-persistent` : browserName;
  writeFileSync(join(OUT, `raw.${suffix}.json`), JSON.stringify(rows, null, 2) + "\n");
  console.log(`\n${rows.length} 件を results/${scenario}/raw.${suffix}.json に保存しました。`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
