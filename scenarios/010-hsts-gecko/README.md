# 010-hsts-gecko

Gecko（Firefox）が HSTS をどこに保持し、どの操作で消えるのかを測る。

Chromium には `chrome://net-internals/#hsts` という画面があるが、**Firefox には無い**。
実体はプロファイル直下の `SiteSecurityServiceState.bin`（バイナリ）で、
キーは最上位サイトで区切られる（`partitionKey`）。

`ui_delete_entries_after` のみ**半自動**（人手で 1 クリック）。理由は `run.sh` のコメント。
