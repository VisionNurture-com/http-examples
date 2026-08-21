// 004 — ステータスコードの選択
//
// 観測対象: 返したコードが、返した先（ブラウザ / プロキシ / HTTP クライアント）で
//           実際に何を変えるか。
//
// 🔴 方針: Express の既定を先回りで直さない。たとえば 401 に WWW-Authenticate を
//    付けないアームは RFC 9110 §15.5.2（MUST）に反するが、「反した実装が実際に何を
//    招くか」が観測対象なので、そのまま返す。
//
// 🔴 再実行でカウンタが残ると 429 の測定が汚れる。
//    シナリオの先頭で POST /004/api/__reset を叩く。

function initialState() {
  return {
    // レート制限のカウンタ。クライアント識別子ごとに数える
    hits: {},
  };
}

let state = initialState();

// ブラウザから見て「本文が描画されたか」「スクリプトが動いたか」を判別できる本文。
// 目印は本文とスクリプトの両方に置き、描画とスクリプト実行を別々に読めるようにする。
function markerBody(code) {
  return `<!doctype html>
<meta charset="utf-8">
<title>004 body ${code}</title>
<p id="marker">BODY-RENDERED-${code}</p>
<script>window.__marker004 = "SCRIPT-RAN-${code}";</script>
`;
}

// codes/:code で返してよいコード。1xx / 204 / 304 は本文を持てないため除く
const ALLOWED_CODES = [200, 201, 400, 401, 403, 404, 410, 418, 422, 429, 451, 500, 502, 503];

export function register(app) {
  // --- 測定の前提を整える口 ------------------------------------------------
  app.post("/004/api/__reset", (_req, res) => {
    state = initialState();
    res.status(204).end();
  });

  app.get("/004/api/state", (_req, res) => res.json(state));

  // --- 401 を返すと何が起きるか（4 アームのうちアプリ側 3 本）--------------
  //
  // ダイアログの引き金は「401 であること」ではなく challenge のスキームだ、という
  // 通説を測る。A = challenge なし（仕様違反）/ B = Basic / C = Bearer。
  // D（プロキシで剥がす）は nginx 側（location /004/stripped/）が担当する。

  app.get("/004/api/auth/none", (_req, res) => {
    // 🔴 RFC 9110 §15.5.2 は WWW-Authenticate を MUST とする。ここは意図的に付けない
    res.status(401).json({ error: "unauthenticated", arm: "none" });
  });

  app.get("/004/api/auth/basic", (_req, res) => {
    res.set("WWW-Authenticate", 'Basic realm="004"');
    res.status(401).json({ error: "unauthenticated", arm: "basic" });
  });

  app.get("/004/api/auth/bearer", (_req, res) => {
    res.set("WWW-Authenticate", 'Bearer realm="004"');
    res.status(401).json({ error: "unauthenticated", arm: "bearer" });
  });

  // 資格情報は届いているが権限が足りない側。RFC 9110 §15.5.4 は
  // 「同じ資格情報での自動再送を SHOULD NOT」とする
  app.get("/004/api/auth/forbidden", (_req, res) => {
    res.status(403).json({ error: "forbidden", arm: "forbidden" });
  });

  // --- Bearer の 401 / 403 は challenge に何を載せるか ----------------------
  //
  // 🔴 上の forbidden は challenge を持たない 403 で、それ自体は正しい。ただし
  //    「403 には challenge が付かない」は一般則ではない。RFC 6750 §3 は、
  //    アクセスを許さないトークンが来た場合も WWW-Authenticate を MUST とし、
  //    §3.1 は insufficient_scope に 403 を SHOULD、invalid_token に 401 を
  //    SHOULD としている。ここは「403 + challenge」が実在する側を測る。
  //
  //    RFC 6750 §3.1 の error 値は 3 つ。ここでは 401 / 403 に落ちる 2 つを返す。

  app.get("/004/api/oauth/invalid-token", (_req, res) => {
    res.set(
      "WWW-Authenticate",
      'Bearer realm="004", error="invalid_token", error_description="The access token expired"',
    );
    res.status(401).type("application/problem+json").send(
      JSON.stringify({
        type: "https://example.com/probs/invalid-token",
        title: "The access token is not valid.",
        status: 401,
        detail: "The access token expired at 2026-08-21T00:00:00Z. Request a new one and retry.",
        instance: "/004/account/12345/msgs/abc",
      }),
    );
  });

  app.get("/004/api/oauth/insufficient-scope", (_req, res) => {
    // scope 属性は §3.1 で MAY。「何が足りないか」を応答自身に載せられる
    res.set(
      "WWW-Authenticate",
      'Bearer realm="004", error="insufficient_scope", scope="msgs:read msgs:write"',
    );
    res.status(403).type("application/problem+json").send(
      JSON.stringify({
        type: "https://example.com/probs/insufficient-scope",
        title: "The access token lacks the required scope.",
        status: 403,
        detail: "This endpoint requires msgs:read and msgs:write. The token carries msgs:read only.",
        instance: "/004/account/12345/msgs/abc",
      }),
    );
  });

  // --- 429 の Retry-After に従うのは誰か -----------------------------------
  //
  // ?cl= クライアント識別子（カウンタの単位）/ ?after= 何回目から 429 にするか
  // ?ra=  Retry-After の秒数
  //
  // 判定はサーバ側の到着間隔で行う（nginx の $msec）。ここは「いつ 429 を返したか」を
  // 記録に残すことだけを担い、クライアントの自己申告は使わない。
  app.get("/004/api/limited", (req, res) => {
    const cl = String(req.query.cl ?? "anon");
    const after = Number(req.query.after ?? 1);
    const ra = String(req.query.ra ?? "3");

    state.hits[cl] = (state.hits[cl] ?? 0) + 1;

    if (state.hits[cl] > after) {
      res.set("Retry-After", ra);
      return res.status(429).json({ error: "too_many_requests", hits: state.hits[cl] });
    }
    return res.status(200).json({ ok: true, hits: state.hits[cl] });
  });

  // 503 + Retry-After。RFC 9110 §10.2.3 が Retry-After の用例として明示するのは
  // 503 と 3xx で、429 は挙げていない（429 の定義は RFC 6585 §4）
  app.get("/004/api/unavailable", (req, res) => {
    res.set("Retry-After", String(req.query.ra ?? "3"));
    res.status(503).json({ error: "service_unavailable" });
  });

  // --- 汎用ソフトはコードで何を変えるか -----------------------------------
  //
  // 同じ本文を、コードだけ変えて返す。ブラウザが描画するか・スクリプトを動かすかを
  // コードごとに読む。
  app.get("/004/api/codes/:code", (req, res) => {
    const code = Number(req.params.code);
    if (!ALLOWED_CODES.includes(code)) {
      return res.status(400).json({ error: "unsupported_code", code });
    }
    if (code === 429 || code === 503) res.set("Retry-After", "3");
    if (code === 401) res.set("WWW-Authenticate", 'Bearer realm="004"');
    // ?cc=1 は「この応答は保存してよい」と応答側が申告するアーム。
    // 前段のキャッシュがコードごとの規定（RFC 6585 §4 の MUST NOT）を持つかを分ける
    if (req.query.cc === "1") res.set("Cache-Control", "max-age=60");
    res.status(code).type("html").send(markerBody(code));
  });

  // --- Problem Details（RFC 9457）------------------------------------------
  //
  // コードで運べない詳細を本文へ置く形。?mismatch=1 は status メンバと実際の
  // ステータスをわざと食い違わせる（RFC 9457 §3.1.2 は同一であることを MUST とする）
  app.get("/004/api/problem", (req, res) => {
    const mismatch = req.query.mismatch === "1";
    res.status(403).type("application/problem+json").send(
      JSON.stringify({
        type: "https://example.com/probs/out-of-credit",
        title: "You do not have enough credit.",
        status: mismatch ? 500 : 403,
        detail: "Your current balance is 30, but that costs 50.",
        instance: "/004/account/12345/msgs/abc",
        balance: 30,
      }),
    );
  });
}
