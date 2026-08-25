# 009-header-arrival — 既定で Authorization を落とす構成はどれか

## 何を測るか

「リバースプロキシを挟むと `Authorization` が消える」という説明をよく見ます。公式ドキュメントを読むと、この説明は少なくとも nginx には当てはまりません。

> By default, the header fields "Host" and "Connection" from the original request are not passed to the proxied server.（`ngx_http_proxy_module` の `proxy_set_header`）

再定義されるのは 2 つだけで、`Authorization` は素通りします。落とすには**空文字列を明示的に代入する**必要があります。

> If the value of a header field is an empty string then this field will not be passed to a proxied server.

一方 Apache は既定で隠します。

> `CGIPassAuth` allows scripts access to HTTP authorization headers such as `Authorization` … **Normally these HTTP headers are hidden from scripts.**（httpd 2.4 core・既定 `Off`・2.4.13 以降）

同じリクエストを 9 経路へ送り、どこで落ちるのかを実測します。

落ちたあとに入れる対処も同じ形で測ります。国内の解説記事が案内する `.htaccess` の 2 通り（`mod_rewrite` / `SetEnvIf`）に加えて、**`CGIPassAuth On` そのものを `.htaccess` に置く**経路も並べました。公式は本ディレクティブの Context を directory と `.htaccess`、Override を `AuthConfig` と定めており、サーバ全体の設定ファイル専用ではありません。

## 記事のどこに出るか

決定表「経路の構成 → `Authorization` は届くか」の**実効値**欄。

## 判定

各終端（Express / PHP / CGI スクリプト）が自分で報告した到着内容だけを読みます。`Authorization` は **あるか / ないか**とスキーム名だけを記録し、値そのものはログに残しません。

## 測れない範囲

**クラウドのロードバランサ・CDN・API ゲートウェイは測っていません**（実機がないため）。ここで測ったのは手元で再現できる 9 経路だけです。

**`AllowOverride` を絞った環境も測っていません。**`.htaccess` に書いた指定が効くかどうかは事業者の許可設定に依存しますが、共用サーバーの実機は持っていません。
