# 008-preflight-auth — Basic 認証をかけた領域への preflight

## 何を測るか

認証をかけた API に別オリジンからリクエストを送ると、**preflight（OPTIONS）だけが 401 で落ちる**ことがあります。preflight は認証情報を載せずに飛ぶためです。

3 つの設定で、preflight に何が返り、本番のリクエストが通るかを測ります。

| ケース | 設定 | 測ること |
|---|---|---|
| **B0 guarded** | `auth_basic` を location 全体にかける | 認証を素直にかけると preflight はどうなるか |
| **B1 exempt** | `map` で OPTIONS のときだけ `auth_basic` を `off` にする | 通る書き方になっているか |
| **B2 shortcut** | `auth_basic` を書いたうえで `return` を content handler にする | 認証は本当に効いているか |

判定は 2 系統です。

1. **サーバ側の OPTIONS 到着記録とそのステータス** — preflight が飛んだか / 何が返ったか
2. **ブラウザ側の `fetch` 結果** — 本番のリクエストが通ったか

加えて **curl で認証なし / ありの両方**を測ります。ブラウザのハーネスは必ず `Authorization` を付けて送るため、「認証なしで通ってしまうか」はブラウザからは観測できないからです。

## 動かす

```bash
docker compose up -d --wait
bash scenarios/008-preflight-auth/run.sh
```

出力は `results/008-preflight-auth/` に入ります。

| ファイル | 中身 |
|---|---|
| `preflight.log` | サーバ側の到着記録（`preflight_ext` 形式）|
| `run.log` | 実施条件 + 全ケースの生の結果 |
| `raw.<browser>.json` | エンジンごとの結果 |
| `curl-probe.json` | 認証なし / ありの curl 実測 |
| `summary.json` | 記事に載せる値（`expected.md` と突合される）|

## 使うアカウントについて（測定前に 2 手順）

このシナリオは Basic 認証をかけた領域を測るため、**アカウントを 1 つ用意してから**実行します。`demo` は**測定専用の合成アカウント**で、実在のユーザーではありません。サーバのログには `auth=yes/no` だけを残し、値そのものは書きません。

🔴 **資格情報はリポジトリに置きません。** `nginx/conf.d/*.htpasswd` は `.gitignore` 済みで、測定スクリプトも値を持たず環境変数から取ります（未設定なら必ず失敗します）。

### 1. htpasswd を作る

```bash
# ハッシュを作って htpasswd へ書く（user は demo・パスワードは任意）
printf 'demo:%s\n' "$(openssl passwd -apr1 '<パスワード>')" > nginx/conf.d/008-authzone.htpasswd
```

### 2. 環境変数へ同じ値を入れる

```bash
export AUTHZONE_CRED='demo:<パスワード>'
```

この 2 つが食い違うと、B0 / B1 / B2 の全ケースが 401 になります。`AUTHZONE_CRED` が未設定のときは `probe-008-preflight-auth.sh` と `measure-008-preflight-auth.mjs` がどちらもエラー終了します（黙って認証なしで測らないためです）。

## 期待値

[`expected.md`](expected.md) を参照してください。`npm run check:provenance` が `summary.json` と突合します。
