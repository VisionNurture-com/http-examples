#!/usr/bin/env node
// measure-001-browser.mjs — 記事 001 の観測手段のうち「ブラウザ」を測る（M2）
//
// 🔴 同梱ブラウザは実ブラウザの代理にならない（MEASURE-01 Step 1b）。
//    Playwright 1.62.1 の同梱は Chromium 151.0.7922.34 / Firefox 153.0 で、
//    実機（Chrome 152.0.7977.65 / Firefox 154.0.1）より古い。
//    Chrome は channel: 'chrome' で実機を起動する。
//
// 測る値（機械可読なものだけ）:
//   - requestfailed の errorText（net::ERR_* の識別子。表示文言ではない）
//   - PerformanceResourceTiming が出るか / どのフェーズまで埋まるか
//     （DevTools の Timing タブが読んでいるのと同じデータ源）
//   - secureConnectionStart が別フィールドとして存在するか（G-7）
//
// 前提: bash tools/gen-certs.sh && docker compose up -d --wait

import { chromium, firefox } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'results', '001-layers');
mkdirSync(OUT_DIR, { recursive: true });

// 🔴 K3 はブラウザから到達できない（docker network の内側でしか作れない）。
const CASES = [
  { id: 'K0',  layer: 'なし（陽性対照）',        url: 'http://localhost:8095/001/ok?cs=K0b' },
  { id: 'K1',  layer: 'DNS',                    url: 'http://nonexistent.invalid/001/ok' },
  { id: 'K2',  layer: 'TCP（拒否）',            url: 'http://localhost:8099/001/ok' },
  { id: 'K4',  layer: 'TLS（自己署名+名前不一致）', url: 'https://localhost:8450/001/ok?cs=K4b2' },
  { id: 'K4b', layer: 'TLS（名前不一致のみ）',   url: 'https://localhost:8451/001/ok?cs=K4bb' },
  { id: 'K5',  layer: 'HTTP',                   url: 'http://localhost:8095/001/http-503?cs=K5b' },
  { id: 'K6',  layer: 'アプリ',                 url: 'http://localhost:8095/001/app-down?cs=K6b' },
  { id: 'K7',  layer: 'TCP は成立・応答なし',    url: 'http://localhost:8096/001/ok' },
  // 🔴 握手まで通る対照。secureConnectionStart は成功した TLS でしか値が入らないため、
  //    これが無いと「API では接続と暗号を分けられる」を測る材料が 1 件も取れない。
  { id: 'K0s', layer: 'なし（TLS の陽性対照）', url: 'https://localhost:8452/001/ok?cs=K0sb' },
];

async function measureOne(browserType, launchOpts, label) {
  const out = {};
  for (const c of CASES) {
    // 🔴 毎ケース新規プロファイル。キャッシュ / DNS / TLS セッション / HSTS の
    //    持ち越しを断つ（VALUE-01 G3 の汚染 #2 / #3 への処置）。
    const userDataDir = mkdtempSync(join(tmpdir(), 'm001-'));
    let ctx;
    try {
      ctx = await browserType.launchPersistentContext(userDataDir, {
        ...launchOpts,
        ignoreHTTPSErrors: false,   // 🔴 true にすると TLS の失敗が消える（curl の -k と同じ罠）
      });
      const page = await ctx.newPage();
      let failure = null;
      page.on('requestfailed', (req) => {
        if (!failure && req.url().startsWith(c.url.split('?')[0])) failure = req.failure()?.errorText ?? null;
      });

      let navStatus = null, navError = null;
      try {
        const resp = await page.goto(c.url, { timeout: 8000, waitUntil: 'commit' });
        navStatus = resp ? resp.status() : null;
      } catch (e) {
        navError = (e.message || '').split('\n')[0];
      }

      // PerformanceResourceTiming（DevTools の Timing タブと同じデータ源）
      let timing = null;
      try {
        timing = await page.evaluate(() => {
          const e = performance.getEntriesByType('navigation')[0];
          if (!e) return { entry: false };
          return {
            entry: true,
            domainLookupStart: e.domainLookupStart, domainLookupEnd: e.domainLookupEnd,
            connectStart: e.connectStart, connectEnd: e.connectEnd,
            secureConnectionStart: e.secureConnectionStart,
            requestStart: e.requestStart, responseStart: e.responseStart,
            has_secureConnectionStart_field: 'secureConnectionStart' in e,
          };
        });
      } catch { timing = { entry: false, reason: 'evaluate 不可（ページが無い）' }; }

      out[c.id] = { layer: c.layer, url: c.url, nav_status: navStatus, nav_error: navError, request_failed: failure, timing };
      console.log(`  ${label} ${c.id.padEnd(4)} status=${navStatus} failed=${failure ?? '-'} navErr=${(navError ?? '-').slice(0, 46)}`);
    } catch (e) {
      out[c.id] = { layer: c.layer, url: c.url, launch_error: (e.message || '').split('\n')[0] };
      console.log(`  ${label} ${c.id.padEnd(4)} 起動/測定エラー: ${(e.message || '').split('\n')[0].slice(0, 60)}`);
    } finally {
      if (ctx) await ctx.close().catch(() => {});
    }
  }
  return out;
}

const results = {};

console.log('[real Chrome]');
const chromeCtxProbe = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'm001v-')), { channel: 'chrome' });
const chromeVersion = chromeCtxProbe.browser().version();
await chromeCtxProbe.close();
results.chrome_real = { version: chromeVersion, cases: await measureOne(chromium, { channel: 'chrome' }, 'chrome') };

console.log('[bundled Firefox]');
const ffProbe = await firefox.launch();
const ffVersion = ffProbe.version();
await ffProbe.close();
results.firefox_bundled = { version: ffVersion, cases: await measureOne(firefox, {}, 'firefox') };

const summary = {
  scenario: '001-layers-browser',
  mode: 'M2',
  measured_at: new Date().toISOString(),
  note: '🔴 Firefox は Playwright 同梱版。実機 Firefox 154.0.1 は未測定（Playwright は同梱ビルド以外を駆動できない）。',
  browsers: { 'chrome-real': results.chrome_real.version, 'firefox-bundled': results.firefox_bundled.version },
  detail: results,
};
writeFileSync(join(OUT_DIR, 'browser.json'), JSON.stringify(summary, null, 2) + '\n');

// 🔴 記事に載せる値は summary.json のトップレベルに置く。
//    check-provenance.mjs はそこしか見ないため、browser.json だけに書くと
//    「記事に載せる値の裏づけ」にならない。
const SUM = join(OUT_DIR, 'summary.json');
const sum = JSON.parse(readFileSync(SUM, 'utf8'));
for (const [engKey, engLabel] of [['chrome_real', 'chrome'], ['firefox_bundled', 'firefox']]) {
  for (const [cid, v] of Object.entries(results[engKey].cases)) {
    sum[`${engLabel}_error_${cid}`] = v.request_failed ?? (v.nav_status !== null ? `status_${v.nav_status}` : 'none');
    sum[`${engLabel}_timing_entry_${cid}`] = Boolean(v.timing?.entry);
  }
}
sum.browsers = summary.browsers;
writeFileSync(SUM, JSON.stringify(sum, null, 2) + '\n');
console.log('\n書き出し: results/001-layers/browser.json + summary.json へ統合');
