#!/usr/bin/env node
// measure-001.mjs — 記事 001「HTTP が繋がらない：層で切り分ける」の実測
//
// 測るもの: 観測手段ごとに、どの層の失敗までを見分けられるか。
//
// 🔴 判定は機械可読な値だけで行う（VALUE-01 G3 の規律）。
//    - curl        : 終了コード + time_namelookup / time_connect / time_appconnect
//    - openssl     : 終了コード + Verify return code の数値
//    - サーバ到着記録: access.log に該当ケースの行が出たか（0 行 / 1 行以上）
//    errormsg は版で変わる文言のため判定に使わず、記録だけ残す。
//
// 🔴 rc だけでは層が決まらない。K3（TCP 無応答）と K7（TCP は成立するが応答が来ない）は
//    どちらもタイムアウト系だが、time_connect が 0 か否かで分かれる。
//
// 前提: bash tools/gen-certs.sh && docker compose up -d --wait

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'results', '001-layers');
const ACCESS_LOG = join(OUT_DIR, 'access.log');
const NET = 'http-examples_httpnet';
const CURL_IMAGE = 'curlimages/curl:8.21.0';

mkdirSync(OUT_DIR, { recursive: true });

// --- ケース定義 -------------------------------------------------------------
// from: 'host' = ホストの curl / 'net' = docker network 内の curl
const CASES = [
  { id: 'K0', layer: 'なし（陽性対照）', url: 'http://localhost:8095/001/ok?cs=K0',        from: 'host', tls: false },
  { id: 'K1', layer: 'DNS',              url: 'http://nonexistent.invalid/001/ok?cs=K1',   from: 'host', tls: false },
  { id: 'K2', layer: 'TCP（拒否）',      url: 'http://localhost:8099/001/ok?cs=K2',        from: 'host', tls: false },
  { id: 'K3', layer: 'TCP（無応答）',    url: 'http://blackhole:9999/001/ok?cs=K3',        from: 'net',  tls: false },
  { id: 'K4', layer: 'TLS',              url: 'https://localhost:8450/001/ok?cs=K4',       from: 'host', tls: true  },
  { id: 'K4b', layer: 'TLS（名前不一致のみ）', url: 'https://localhost:8451/001/ok?cs=K4b', from: 'host', tls: true },
  { id: 'K5', layer: 'HTTP',             url: 'http://localhost:8095/001/http-503?cs=K5',  from: 'host', tls: false },
  { id: 'K6', layer: 'アプリ',           url: 'http://localhost:8095/001/app-down?cs=K6',  from: 'host', tls: false },
  { id: 'K7', layer: 'TCP は成立・応答なし', url: 'http://localhost:8096/001/ok?cs=K7',    from: 'host', tls: false },
  // 🔴 握手まで通る対照。K4 / K4b は失敗するため time_appconnect が 0 のまま終わり、
  //    「接続と暗号を分けられるか」を主張する材料が 1 件も取れない。
  { id: 'K0s', layer: 'なし（TLS の陽性対照）', url: 'https://localhost:8452/001/ok?cs=K0s', from: 'host', tls: true },
];

const W = ['exitcode=%{exitcode}', 'http_code=%{http_code}',
           'time_namelookup=%{time_namelookup}', 'time_connect=%{time_connect}',
           'time_appconnect=%{time_appconnect}', 'time_starttransfer=%{time_starttransfer}',
           'errormsg=%{errormsg}'].join('\n');

function run(file, args, timeoutMs = 30000) {
  try {
    return { rc: 0, out: execFileSync(file, args, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { rc: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

function parseW(text) {
  const o = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) o[line.slice(0, i)] = line.slice(i + 1);
  }
  return o;
}

// --- 観測手段 1: curl -------------------------------------------------------
function observeCurl(c) {
  // 🔴 -k（--insecure）を付けてはいけない。付けると TLS の名前不一致（K4）が
  //    exit=0 に化け、要求がサーバまで届いて access.log にも 1 行出る。
  //    2026-08-26 の初回実行で実際にそうなった（測定器が観測対象を消した例）。
  // 🔴 K0s だけは信頼の起点を明示する。mkcert がある環境では OS の信頼ストアで通るが、
  //    無い環境では server.crt が自己署名になり、同じコマンドが検証で止まる（CI で実際に落ちた）。
  //    --cacert は -k と違い検証を省かない。起点を指定したうえで検証させる。
  const caArgs = c.id === 'K0s' ? ['--cacert', join(ROOT, 'certs', 'k0s-ca.pem')] : [];
  const common = ['-s', '-o', '/dev/null', '--max-time', '8', ...caArgs, '-w', W, c.url];
  const r = c.from === 'net'
    ? run('docker', ['run', '--rm', '--network', NET, CURL_IMAGE, ...common])
    : run('curl', common);
  const w = parseW(r.out);
  return {
    exit: Number(w.exitcode ?? r.rc),
    http_code: Number(w.http_code ?? 0),
    time_namelookup: Number(w.time_namelookup ?? 0),
    time_connect: Number(w.time_connect ?? 0),
    time_appconnect: Number(w.time_appconnect ?? 0),
    errormsg: (w.errormsg ?? '').trim(),
  };
}

// --- 観測手段 2: openssl s_client -------------------------------------------
// 平文の口へは TLS で話しかけられないため、TLS 以外のケースでも「何を返すか」を測る。
function observeOpenssl(c) {
  const u = new URL(c.url);
  const host = u.hostname;
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (c.from === 'net') {
    return { applicable: false, reason: 'docker network 内の宛先のためホストから到達できない' };
  }
  // 🔴 -brief を付けてはいけない。"Verify return code:" の行が出なくなる。
  // 🔴 -verify_return_error が無いと、検証に失敗しても終了コードが 0 のままになる。
  //    2026-08-26 の初回実行で K4（名前不一致）が exit=0 / verify_return_code=null に化けた。
  const r = run('openssl', ['s_client', '-connect', `${host}:${port}`, '-servername', host,
                            '-verify_return_error', '-verify_hostname', host], 12000);
  const m = /Verify return code:\s*(\d+)/.exec(r.out);
  const vm = /verify error:num=(\d+)/.exec(r.out);
  return {
    applicable: true,
    exit: r.rc,
    verify_return_code: m ? Number(m[1]) : (vm ? Number(vm[1]) : null),
    first_error_line: (r.out.split('\n').find(l => /error|failure|refused|resolve/i.test(l)) ?? '').trim(),
  };
}

// --- 観測手段 3: サーバ側の到着記録 -----------------------------------------
function observeServerLog(caseId, before) {
  const now = existsSync(ACCESS_LOG) ? readFileSync(ACCESS_LOG, 'utf8') : '';
  const added = now.slice(before.length);
  const lines = added.split('\n').filter(l => l.includes(`cs=${caseId}`));
  return { arrivals: lines.length, lines };
}

// --- 実行 -------------------------------------------------------------------
const startedAt = new Date().toISOString();
const results = {};
const raw = [];

for (const c of CASES) {
  const before = existsSync(ACCESS_LOG) ? readFileSync(ACCESS_LOG, 'utf8') : '';
  const curl = observeCurl(c);
  const openssl = observeOpenssl(c);
  // nginx のログ書き出しを待つ
  execFileSync('sh', ['-c', 'sleep 0.4']);
  const server = observeServerLog(c.id, before);

  results[c.id] = { layer: c.layer, from: c.from, url: c.url, curl, openssl, server };
  raw.push(`### ${c.id}（${c.layer}）\nURL: ${c.url}\ncurl: ${JSON.stringify(curl)}\nopenssl: ${JSON.stringify(openssl)}\nserver: ${JSON.stringify(server)}\n`);
  console.log(`${c.id} ${c.layer} → curl exit=${curl.exit} tcon=${curl.time_connect} tapp=${curl.time_appconnect} / server arrivals=${server.arrivals}`);
}

// --- 版の記録 ---------------------------------------------------------------
const versions = {
  curl_host: run('curl', ['--version']).out.split('\n')[0],
  openssl_host: run('openssl', ['version']).out.trim(),
  curl_image: CURL_IMAGE,
  nginx: run('docker', ['compose', 'exec', '-T', 'edge', 'nginx', '-v']).out.trim(),
  docker: run('docker', ['--version']).out.trim(),
  os: run('sw_vers', ['-productVersion']).out.trim(),
};

// 🔴 突合される値は summary.json の**トップレベル**に置く。
//    check-provenance.mjs は `k in summary` で見るため、values: {...} に入れ子にすると
//    「summary.json に "..." がありません」で全件落ちる（2026-08-26 に実際に落とした）。
const summary = {
  scenario: '001-layers',
  mode: 'M1',
  measured_at: startedAt,
  versions,
  // 判定に使う機械可読な値だけをトップレベルへ
  ...Object.fromEntries(CASES.flatMap(c => {
    const r = results[c.id];
    return [
      [`exit_${c.id}`, r.curl.exit],
      [`time_connect_nonzero_${c.id}`, r.curl.time_connect > 0],
      // 🔴 握手まで通ったかどうか。成功した TLS でしか値が入らない
      [`time_appconnect_nonzero_${c.id}`, r.curl.time_appconnect > 0],
      [`arrivals_${c.id}`, r.server.arrivals],
    ];
  })),
  curl_version: versions.curl_host.split(' ')[1],
  detail: results,
};

// 🔴 M2（実ブラウザ）の値を取りこぼさない。
//    run.sh は M1 だけを走らせるため、ここで summary.json を素朴に上書きすると
//    measure-001-browser.mjs が統合した chrome_error_* / firefox_error_* が消え、
//    `npm run check:provenance` が 15 件 FAIL する（2026-08-26 に実際に落とした）。
//    記事は読者に run.sh の実行を案内しているので、読者の手元でも同じことが起きる。
//    M1 の値は常に今回の実測で上書きし、M2 の値は browser.json（M2 の成果物）から
//    derive し直して merge する（古い summary.json の値を温存するのではない）。
const BROWSER_JSON = join(OUT_DIR, 'browser.json');
if (existsSync(BROWSER_JSON)) {
  const bj = JSON.parse(readFileSync(BROWSER_JSON, 'utf8'));
  for (const [engKey, engLabel] of [['chrome_real', 'chrome'], ['firefox_bundled', 'firefox']]) {
    for (const [cid, v] of Object.entries(bj.detail?.[engKey]?.cases ?? {})) {
      summary[`${engLabel}_error_${cid}`] = v.request_failed ?? (v.nav_status !== null ? `status_${v.nav_status}` : 'none');
      summary[`${engLabel}_timing_entry_${cid}`] = Boolean(v.timing?.entry);
      // 🔴 接続と暗号を分けられるかの材料。
      //    secureConnectionStart は平文では 0、TLS では非 0 になる（MDN）。
      //    ミリ秒の分解能に丸まると connectStart と一致するため、
      //    「一致したか」は台帳に入れず、非 0 かどうかと connectEnd との前後だけを持つ。
      const tm = v.timing;
      if (tm && tm.entry) {
        summary[`${engLabel}_secure_start_nonzero_${cid}`] = Number(tm.secureConnectionStart) > 0;
        summary[`${engLabel}_connect_end_gt_secure_start_${cid}`] =
          Number(tm.connectEnd) > Number(tm.secureConnectionStart);
      }
    }
  }
  summary.browsers = bj.browsers;
  summary.browser_measured_at = bj.measured_at;
  console.log(`\nM2 の値を browser.json（${bj.measured_at}）から統合しました`);
}

writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(join(OUT_DIR, 'run.log'), `measured_at: ${startedAt}\n\n` + raw.join('\n'));
console.log(`\n書き出し: results/001-layers/summary.json / run.log`);
