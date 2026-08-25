# 010-hsts-gecko の期待値

記事に載せる値の正本。`results/010-hsts-gecko/summary.json` と突合される。

## 測る対象

**ブラウザが状態をどこに持つか**。Chromium の `chrome://net-internals/#hsts` に相当する画面は
Firefox に無く、実体はプロファイル直下のファイルである。

## 実測結果

| ケース | 手順 | 結果 |
|---|---|---|
| **G0** 対照 | 登録なしで起動 | 🔴 **状態ファイルそのものが無い** |
| **G1** | `max-age=600` を受け取る | `SiteSecurityServiceState.bin` に 1 行。キーは `example.test^partitionKey=%28https%2Cexample.test%29` / **includeSubDomains false** |
| **G2** | `max-age=600; includeSubDomains` | 同じキーで **includeSubDomains true** |
| **G3** | 登録 → `max-age=0` | 🔴 **行が消える**（無効化ではなく削除）|
| **UI** | 履歴 →「このサイトを忘れる」| 🔴 **行が消える**（`max-age=0` と同じ結果）|

**同梱 Firefox 153.0 と実 Firefox 154.0 で機構は同一**（実 Firefox でも G1 と同じ行が書かれる）。

> 🔴 **保存先の名前は `.bin` である。**`.txt` は旧世代の名前で、153.0 / 154.0 のどちらにも存在しない。
> 名前から推測して探すと「状態が無い」と誤読する。
>
> ⏸ **UI 削除の測定だけは人手が要る。**Firefox の chrome UI は macOS のアクセシビリティ API に
> ほぼ露出せず（実測でライブラリ画面も本体ウィンドウも `AXButton` 3 個のみ）、
> Playwright は Juggler パッチ入りビルドのため実 Firefox を操作できない。
>
> ⏸ **preload 由来（static）は未測定。**Firefox の preload リストはビルドに埋め込まれており、
> 本シナリオの `example.test` では作れない。

```json
{
  "scenario": "010-hsts-gecko",
  "mode": "M2",
  "values": {
    "state_file_name": "SiteSecurityServiceState.bin",
    "engine_versions": { "bundled_firefox": "153.0", "real_firefox": "154.0" },
    "g0_state_file_exists": false,
    "g1_entry_key": "example.test^partitionKey=%28https%2Cexample.test%29",
    "g1_include_subdomains": false,
    "g2_include_subdomains": true,
    "g3_entries_after_maxage0": 0,
    "real_firefox_entries": 1,
    "ui_delete_entries_after": 0,
    "ui_delete_automatable": false
  }
}
```
