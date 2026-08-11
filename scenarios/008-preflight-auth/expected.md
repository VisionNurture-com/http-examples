# 008-preflight-auth の期待値

記事に載せる値の正本。`results/008-preflight-auth/summary.json` と突合される。

## 実測の条件

| 項目 | 値 |
|---|---|
| Chromium | 151.0.7922.34 |
| Firefox | 153.0 |
| WebKit | 26.5（Playwright 同梱。**Safari そのものではない**）|
| nginx | 1.31.3-alpine |
| 認証方式 | Basic 認証（`auth_basic` + `auth_basic_user_file`）|
| 使ったアカウント | **測定専用の合成アカウント**（`demo`）。実在のユーザーではない。サーバのログには `auth=yes/no` だけを残す |
| 宣言した `Access-Control-Max-Age` | 30 秒 |
| 測定日 | 2026-08-09 |

## 3 つの設定

| ケース | 設定 | 狙い |
|---|---|---|
| **B0 guarded** | `auth_basic` を location 全体にかけ、実ファイルを返す | 認証を素直にかけるとどうなるか |
| **B1 exempt** | `map $request_method $authzone_realm`（OPTIONS のとき `off`）で OPTIONS だけ認証から外す | 通る書き方 |
| **B2 shortcut** | `auth_basic` を書いたうえで `return` を content handler にする | 守れているつもりの設定 |

## 実測結果（ブラウザ）

| ケース | preflight のステータス | OPTIONS 到着数 | fetch |
|---|:--:|:--:|:--:|
| **B0 guarded** | **401** | Chromium 1 / Firefox 1 / **WebKit 2** | **失敗**（3 エンジン一致）|
| B1 exempt | 204 | 1（3 エンジン一致）| 成功 200（3 エンジン一致）|
| B2 shortcut | 204 | 1（3 エンジン一致）| 成功 200（3 エンジン一致）|

エラーメッセージはエンジンごとに違う（Chromium `Failed to fetch` / Firefox `NetworkError when attempting to fetch resource.` / WebKit `Load failed`）が、**落ちること自体は 3 エンジンで一致**した。

**WebKit だけ OPTIONS を 2 本送る**。401 を受けて認証を付け直そうとする挙動と読めるが、2 本目も 401 で、結果は変わらない。

## 実測結果（curl・認証の有無を変える）

ブラウザのハーネスは必ず `Authorization` を付けて送るため、「認証なしで通ってしまうか」はブラウザからは観測できない。ここは curl で測った。

| ケース | OPTIONS（認証なし）| GET（認証なし）| GET（認証あり）|
|---|:--:|:--:|:--:|
| B0 guarded | 401 | 401 | 200 |
| B1 exempt | 204 | **401** | 200 |
| **B2 shortcut** | 204 | **200** | 200 |

## 🔴 読み取り

### ① preflight は認証情報を載せずに飛ぶ

**B0 は 3 エンジンとも fetch が落ちました**。本番のリクエストは一度も送られていません。`Authorization` を付けて `fetch` を呼んでいるのに落ちるのは、**preflight にはその `Authorization` が乗らない**からです。サーバは認証なしの OPTIONS を受け取り 401 を返し、ブラウザはそこで打ち切ります。

**401 応答にも CORS ヘッダは付いていました**（`always` を付けているため）。それでも落ちます。**preflight の合否はステータスで決まり、ヘッダが揃っているかどうかではありません**。

### ② `return` を content handler にすると `auth_basic` は一度も動かない

**B2 は認証なしの GET が 200 で通りました**。`auth_basic` を書いてあるのにです。

`return` は `ngx_http_rewrite_module` の指令で **rewrite フェーズ**で応答を返します。`auth_basic` が動くのは **access フェーズ**で、これは rewrite フェーズより後です。したがって `return` が content handler になっている location では、認証は一度も評価されません。

CORS の設定例は `return 200 "..."` の形で書かれることが多く、**そこに `auth_basic` を足しても効きません**。B0 / B1 が実ファイルを返しているのはこのためです。

### ③ `limit_except` は静的配信と併用できない（測定中に見つけた）

最初は `limit_except OPTIONS { auth_basic ...; }` で B1 を書きました。認証の除外自体は効きましたが、**GET が 404 になりました**。`limit_except` の内側は独立した設定コンテキストで、**外側の `root` / `try_files` / `return` を content handler として引き継ぎません**。

`auth_basic` は nginx 1.5.6 から変数を取れるため、`map` で OPTIONS のときだけ `off` にする書き方に変えて解決しました。

```json
{
  "scenario": "008-preflight-auth",
  "mode": "M2",
  "browsers": ["chromium", "firefox", "webkit"],
  "values": {
    "case_count": 3,
    "B0_fetch_ok": false,
    "B0_preflight_status": 401,
    "B0_preflight_count": "browsers_disagree",
    "B0_preflight_count_chromium": 1,
    "B0_preflight_count_firefox": 1,
    "B0_preflight_count_webkit": 2,
    "B1_fetch_ok": true,
    "B1_preflight_status": 204,
    "B1_preflight_count": 1,
    "B2_fetch_ok": true,
    "B2_preflight_status": 204,
    "B2_preflight_count": 1,
    "curl_guarded_options_noauth": 401,
    "curl_guarded_get_noauth": 401,
    "curl_guarded_get_auth": 200,
    "curl_exempt_options_noauth": 204,
    "curl_exempt_get_noauth": 401,
    "curl_exempt_get_auth": 200,
    "curl_shortcut_options_noauth": 204,
    "curl_shortcut_get_noauth": 200,
    "curl_shortcut_get_auth": 200
  },
  "config_refs": [
    {
      "path": "nginx/conf.d/008-cors.conf",
      "must_contain": [
        "location ~ ^/008/authzone/guarded(/.*)?$",
        "location ~ ^/008/authzone/exempt(/.*)?$",
        "location ~ ^/008/authzone/shortcut(/.*)?$",
        "map $request_method $authzone_realm {",
        "    default \"measurement zone\";",
        "    OPTIONS \"off\";",
        "auth_basic           $authzone_realm;",
        "auth_basic_user_file /etc/nginx/conf.d/008-authzone.htpasswd;",
        "add_header Access-Control-Allow-Headers \"authorization, x-probe\"   always;",
        "try_files /authzone/payload.txt =404;"
      ]
    }
  ]
}
```
