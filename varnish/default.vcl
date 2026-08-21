# default.vcl — 記事 004 の「前段のキャッシュはコードを見ているか」対照
#
# 🔴 記事に載せる設定は本ファイルが正本。記事側で書き起こさない。
#
# nginx 側（004-status.conf）は proxy_cache_valid で保存を命じられる。
# Varnish は既定 VCL の判断に委ね、保存の可否を応答の Cache-Control に任せる。
# RFC 6585 §4 の「429 はキャッシュに保存してはならない」を実装が持つなら、
# Cache-Control: max-age=60 がついた 429 でも保存されないはず。

vcl 4.1;

backend default {
    .host = "app";
    .port = "3000";
}

sub vcl_deliver {
    # 保存されたものが返ったかを外から読めるようにする
    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
    } else {
        set resp.http.X-Cache = "MISS";
    }
    set resp.http.X-Cache-Hits = obj.hits;
}
