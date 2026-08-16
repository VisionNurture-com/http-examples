# Brotli モジュール入りの nginx（記事 012 カード②の測定専用）
#
# 🔴 公式 nginx イメージには Brotli モジュールが入っていない。そのため
#    Alpine の配布パッケージから組む。版は固定する（実測値の出典を残すため）。
#    本体は Alpine の nginx 1.28.3（stable）で、他のシナリオで使う
#    公式 mainline 1.31.3 とは版が違う。この差は測定記録に明記する。
FROM alpine:3.22

RUN apk add --no-cache \
      nginx=1.28.3-r7 \
      nginx-mod-http-brotli=1.28.3-r7

EXPOSE 87
CMD ["nginx", "-g", "daemon off;"]
