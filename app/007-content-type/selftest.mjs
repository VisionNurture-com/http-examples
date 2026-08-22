// selftest.mjs — 実ブラウザで開くと全ケースを自動実行し、結果を /007/report へ送るページ
//
// Playwright から駆動できない本物の Firefox / Safari で測るための経路。
// ケースの定義は tools/capture-007-browser.mjs / tools/measure-007-worker-mime.mjs と
// 同じ並びに保つ（食い違うと同梱版との比較ができなくなる）。
export const SELFTEST_HTML = `<!doctype html>
<meta charset="utf-8">
<title>007 selftest</title>
<style>body{font:14px/1.6 system-ui;margin:2rem}td,th{border:1px solid #ccc;padding:.2rem .5rem}</style>
<body>
<h1>007 selftest</h1>
<p id="state">実行中…</p>
<table id="out"><tr><th>id</th><th>destination</th><th>Content-Type</th><th>nosniff</th><th>結果</th></tr></table>
<script>
const DEST = [
  { id: "D1",  dest: "classic script", kind: "js",     ct: "text/html",  nosniff: 0 },
  { id: "D2",  dest: "classic script", kind: "js",     ct: "text/html",  nosniff: 1 },
  { id: "D3",  dest: "classic script", kind: "js",     ct: "text/plain", nosniff: 0 },
  { id: "D4",  dest: "classic script", kind: "js",     ct: "text/plain", nosniff: 1 },
  { id: "D5",  dest: "module script",  kind: "js",     ct: "text/html",  nosniff: 0 },
  { id: "D6",  dest: "module script",  kind: "js",     ct: "text/html",  nosniff: 1 },
  { id: "D7",  dest: "style",          kind: "css",    ct: "text/plain", nosniff: 0 },
  { id: "D8",  dest: "style",          kind: "css",    ct: "text/plain", nosniff: 1 },
  { id: "D9",  dest: "classic worker", kind: "worker", ct: "text/html",  nosniff: 0 },
  { id: "D10", dest: "classic worker", kind: "worker", ct: "text/html",  nosniff: 1 },
];
const WORKER = [
  { id: "W1", ct: "text/javascript",          js: true  },
  { id: "W2", ct: "text/html",                js: false },
  { id: "W3", ct: "text/plain",               js: false },
  { id: "W4", ct: "application/json",         js: false },
  { id: "W5", ct: "text/css",                 js: false },
  { id: "W6", ct: "image/png",                js: false },
  { id: "W7", ct: "application/octet-stream", js: false },
];
window.__flags = {};
const url = (kind, flag, ct, nosniff) =>
  "/007/asset?kind=" + kind + "&flag=" + flag + "&ct=" + encodeURIComponent(ct) + (nosniff ? "&nosniff=1" : "");
const waitEl = (el) => new Promise((res) => { el.onload = () => res("load"); el.onerror = () => res("error"); document.head.appendChild(el); });
function runWorker(u, flag) {
  return new Promise((res) => {
    let w; const t = setTimeout(() => { try { w && w.terminate(); } catch (e) {} res("timeout"); }, 4000);
    try { w = new Worker(u); } catch (e) { clearTimeout(t); return res("throw"); }
    w.onmessage = (m) => { clearTimeout(t); w.terminate(); res(m.data === flag ? "loaded" : "unexpected"); };
    w.onerror = () => { clearTimeout(t); res("blocked"); };
  });
}
function row(cells) {
  const tr = document.createElement("tr");
  for (const c of cells) { const td = document.createElement("td"); td.textContent = String(c); tr.appendChild(td); }
  document.getElementById("out").appendChild(tr);
}
(async () => {
  const destination = {}, worker = {};
  for (const c of DEST) {
    const u = url(c.kind, c.id, c.ct, c.nosniff);
    let executed = false, event = "";
    if (c.dest === "classic script" || c.dest === "module script") {
      const s = document.createElement("script");
      if (c.dest === "module script") s.type = "module";
      s.src = u; event = await waitEl(s); executed = window.__flags[c.id] === true;
    } else if (c.dest === "style") {
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = u;
      event = await waitEl(l);
      executed = getComputedStyle(document.documentElement).getPropertyValue("--probe-" + c.id).trim() === "1";
    } else {
      const r = await runWorker(u, c.id); event = r; executed = r === "loaded";
    }
    destination[c.id] = { ...c, event, executed };
    row([c.id, c.dest, c.ct, c.nosniff ? "あり" : "なし", executed ? "実行/適用された" : "止まった"]);
  }
  for (const t of WORKER) {
    const u = url("worker", t.id, t.ct, 0);
    const served = await fetch(u).then((r) => r.headers.get("content-type")).catch(() => null);
    const result = await runWorker(u, t.id);
    worker[t.id] = { ...t, served, result };
    row([t.id, "classic worker", t.ct, "なし", result]);
  }
  // document ナビゲーションの対照は iframe で見る（このページを離れずに測る）
  const doc = {};
  for (const [id, path] of [["D11", "/007/text-as-html"], ["D12", "/007/text-as-html-nosniff"]]) {
    doc[id] = await new Promise((res) => {
      const f = document.createElement("iframe");
      f.style.display = "none"; f.src = path;
      f.onload = () => {
        let o;
        try {
          const d = f.contentDocument;
          o = { contentType: d.contentType, hasBoldElement: !!d.querySelector("b") };
        } catch (e) { o = { contentType: "unreadable", hasBoldElement: null }; }
        f.remove(); res(o);
      };
      document.body.appendChild(f);
    });
    row([id, "document (iframe)", "text/plain", id === "D12" ? "あり" : "なし",
         doc[id].contentType + " / bold=" + doc[id].hasBoldElement]);
  }
  const payload = { destination, worker, doc, ua: navigator.userAgent };
  const r = await fetch("/007/report", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const j = await r.json();
  document.getElementById("state").textContent = "完了しました（報告 " + j.count + " 件目）。このタブは閉じてかまいません。";
})();
</script>
</body>`;
