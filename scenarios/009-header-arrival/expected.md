# 009-header-arrival の期待値

記事に載せる値の正本。`results/009-header-arrival/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| nginx | 1.31.4-alpine |
| Apache httpd | 2.4.68-alpine |
| PHP-FPM | 8.5.9-fpm-alpine |
| Express | 5.2.1（node 24.19.0）|
| 測定日 | 2026-08-23（P8 の追加は 2026-08-24 / **P9・P10 の追加も 2026-08-24**）|

## 実測結果

同じ `Authorization: Bearer …` を 11 経路へ送り、終端に届いたかを読みます。経路は 3 種類に分けます。**既定**（何も足していない）・**落とす設定**（自分で落とした）・**直す設定**（落ちたあとに入れる対処）です。

| 経路 | 区分 | 構成 | 終端に届いたか |
|---|---|---|:--:|
| P0 | 対照 | Express 直 | **届く** |
| P1 | 既定 | nginx `proxy_pass` | **届く** |
| P2 | 落とす設定 | nginx + `proxy_set_header Authorization ""` | **落ちる** |
| P3 | 既定 | nginx `fastcgi_pass` → PHP-FPM | **届く** |
| **P4** | **既定** | **Apache `mod_cgid`（`CGIPassAuth` 既定 `Off`）** | **落ちる** |
| P5 | 直す設定 | Apache `mod_cgid` + `CGIPassAuth On` | **届く** |
| P6 | 直す設定 | 同上 + `.htaccess` の `mod_rewrite`（`E=HTTP_AUTHORIZATION`）| **届く** |
| P7 | 直す設定 | 同上 + `.htaccess` の `SetEnvIf` | **届く** |
| P8 | 直す設定 | 同上 + `.htaccess` の `CGIPassAuth On`（`AllowOverride AuthConfig`）| **届く** |
| **P9** | **既定** | **Apache `mod_proxy_fcgi` → PHP-FPM（`CGIPassAuth` 既定 `Off`）** | **落ちる** |
| P10 | 直す設定 | Apache `mod_proxy_fcgi` → PHP-FPM + `CGIPassAuth On` | **届く** |

## 読み取り

**既定の経路は 4 つ（P1 / P3 / P4 / P9）で、落ちたのはそのうち 2 つ**でした。**どちらも Apache 側**です（P4 = CGI / P9 = FastCGI）。

> 🔴 **2026-08-24 追加（P9 / P10）。**「PHP の実行方式を CGI から FPM へ変えれば直る」という案内が国内に流通しているため、Apache のまま実行方式だけを FastCGI（`mod_proxy_fcgi`）へ変えて測った。
> **結果は落ちる**（P9）。同じ経路に `CGIPassAuth On` を書くと届く（P10）。つまり **`CGIPassAuth` の既定 `Off` は CGI だけでなく Apache の FastCGI 経路にも効く**。
> 落ちる条件は「CGI で動かしていること」ではなく「**Apache がスクリプトへ渡していること**」だった。nginx の FastCGI（P3）が届くのは、この仕組みを Apache 側が持ち nginx 側が持たないためである。

nginx は素の転送でも（P1）、FastCGI 越しでも（P3）`Authorization` を渡します。落ちた P2 は、**こちらが落とす設定を自分で書いた**結果です。つまり「リバースプロキシを挟むと消える」は、nginx では**設定を書かないかぎり起きません**。

Apache 側は逆で、**何も書かなければ隠されます**。この差はモジュールの実装差ではなく、Apache が意図して設けた既定です。**CGI（P4）でも FastCGI（P9）でも同じように隠され、どちらも `CGIPassAuth On` で解除できます**（P5 / P10）。

> This is to disallow scripts from seeing user ids and passwords used to access the server when HTTP Basic authentication is enabled in the web server.

落ちたあとに入れる対処は 5 通りあり、**5 つとも届きました**。国内の解説記事が案内するのは `.htaccess` に書く 2 通り（P6 / P7）で、どちらも `CGIPassAuth` を `Off` のままにして、値を `HTTP_AUTHORIZATION` という環境変数へ自分で写します。

🔴 **`CGIPassAuth` そのものも `.htaccess` に書けます（P8）。**公式は本ディレクティブの Context を directory と `.htaccess`、Override を `AuthConfig` と定めており、「サーバ全体の設定だから共用サーバーの利用者は触れない」は正確ではありません。事業者が `AllowOverride AuthConfig` を許していれば 1 行で解除できます。効かない環境があるとすれば、原因は書き方ではなく**その上書きが許可されているかどうか**です。

P6 / P7 / P8 / P10 が「いつでも届いたと言うだけ」でないことは、**`Authorization` を付けずに同じ URL を叩いて `no` が返ること**で確かめています。

```json
{
  "scenario": "009-header-arrival",
  "mode": "M1",
  "values": {
    "paths_total": 11,
    "arrived_count": 8,
    "dropped_count": 3,
    "dropped_cases": ["P2", "P4", "P9"],
    "default_cases": ["P1", "P3", "P4", "P9"],
    "dropped_by_default_count": 2,
    "dropped_by_default_cases": ["P4", "P9"],
    "fix_cases": ["P5", "P6", "P7", "P8", "P10"],
    "fix_effective_count": 5,
    "fix_effective_cases": ["P5", "P6", "P7", "P8", "P10"],
    "P0_auth": "yes",
    "P1_auth": "yes",
    "P2_auth": "no",
    "P3_auth": "yes",
    "P4_auth": "no",
    "P5_auth": "yes",
    "P6_auth": "yes",
    "P7_auth": "yes",
    "P8_auth": "yes",
    "P9_auth": "no",
    "P10_auth": "yes",
    "P6_auth_without_header": "no",
    "P7_auth_without_header": "no",
    "P8_auth_without_header": "no",
    "P10_auth_without_header": "no"
  },
  "config_refs": [
    { "path": "nginx/conf.d/009-auth.conf", "must_contain": ["proxy_set_header Authorization \"\";", "fastcgi_pass   php:9000;"] },
    { "path": "apache/009-auth.conf", "must_contain": ["CGIPassAuth On", "ScriptAlias /009/cgi-off/"] },
    { "path": "apache/htaccess-rewrite/.htaccess", "must_contain": ["RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]"] },
    { "path": "apache/htaccess-setenvif/.htaccess", "must_contain": ["SetEnvIf Authorization \"(.*)\" HTTP_AUTHORIZATION=$1"] },
    { "path": "apache/htaccess-cgipassauth/.htaccess", "must_contain": ["CGIPassAuth On"] },
    { "path": "compose.yaml", "must_contain": ["httpd:2.4.68-alpine", "php:8.5.9-fpm-alpine"] }
  ]
}
```
