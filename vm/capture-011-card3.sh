#!/usr/bin/env bash
# capture-011-card3.sh — カード③「ディストリビューションの apt 版は HTTP/3 を話せるか」
# 生ログを results-011/card3-<codename>.log に落とす（provenance 用）。
# 引数なしで動く。24.04 / 26.04 のどちらでも同じスクリプトを流す。

set -uo pipefail
OUT=/home/ubuntu/results-011
mkdir -p "$OUT"
. /etc/os-release
LOG="$OUT/card3-${VERSION_ID}.log"

{
  echo "measured-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host: multipass ${PRETTY_NAME} / kernel $(uname -r) / $(dpkg --print-architecture) / $(nproc) vCPU"
  echo "note: カード③ = apt 版の HTTP/3 ビルド有無。M3（手動・CI 対象外）"
  echo ""

  echo "## 1. apt-cache policy curl"
  apt-cache policy curl
  echo ""

  echo "## 2. curl -V（apt 版）"
  /usr/bin/curl -V
  echo ""

  echo "## 3. curl の Features に HTTP3 が含まれるか（1=あり / 0=なし）"
  /usr/bin/curl -V | grep -c "HTTP3"
  echo ""

  echo "## 4. apt-cache policy nginx"
  apt-cache policy nginx
  echo ""

  echo "## 5. nginx -v / -V のビルドオプション"
  nginx -v 2>&1
  echo "with-http_v2_module: $(nginx -V 2>&1 | grep -c 'with-http_v2_module')"
  echo "with-http_v3_module: $(nginx -V 2>&1 | grep -c 'with-http_v3_module')"
  echo ""

  echo "## 6. QUIC ライブラリの在庫（apt-cache search）"
  apt-cache search "^libngtcp2" 2>/dev/null | sort
  apt-cache search "^libnghttp3" 2>/dev/null | sort
  echo ""

  echo "## 7. OpenSSL"
  openssl version
  echo ""

  echo "## 8. ソースビルドした curl（存在する場合のみ）"
  if [ -x /opt/curl-h3/bin/curl ]; then
    /opt/curl-h3/bin/curl -V
    echo "HTTP3 の有無: $(/opt/curl-h3/bin/curl -V | grep -c 'HTTP3')"
    echo "--- configure の該当行 ---"
    grep -E "HTTP3|HTTP2:" /home/ubuntu/curl-configure.log 2>/dev/null
  else
    echo "（この VM ではソースビルドしていない）"
  fi
} > "$LOG" 2>&1

echo "written: $LOG"
wc -l "$LOG"
