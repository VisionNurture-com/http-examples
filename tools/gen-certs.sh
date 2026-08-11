#!/usr/bin/env bash
# gen-certs.sh — M1 / M2 用のローカル証明書を生成する
#
# 方針（C 案）: mkcert があればそれを使い、無ければ openssl の自己署名へ落とす。
#
#   mkcert あり : ローカル CA が OS の信頼ストアに入るため、ブラウザ警告が出ない。
#                 HSTS は証明書エラーをバイパスした接続には適用されないため、
#                 010（HSTS）の M2 シナリオは実質 mkcert が要る。
#   mkcert なし : 自己署名。curl -k で済む M1 のシナリオは問題なく測れる。
#                 ブラウザを使う M2 では警告が出る。
#
# 生成物は certs/ に置き .gitignore 済み（リポジトリに含めない）。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/certs"
DOMAIN="${DOMAIN:-localhost}"
ALT="${ALT:-example.test}"

mkdir -p "$CERT_DIR"

if command -v mkcert >/dev/null 2>&1; then
    echo "[gen-certs] mkcert を使用します"

    # -install は OS の信頼ストアを触るため sudo が要る。非対話シェルでは失敗するが、
    # 証明書の発行自体は CA が手元にあれば行える。ここで中断させない。
    TRUSTED="no"
    if mkcert -install >/dev/null 2>&1; then
        TRUSTED="yes"
    else
        echo "[gen-certs] ⚠️ mkcert -install に失敗しました（sudo が必要です）。"
        echo "[gen-certs]    証明書は発行しますが、ブラウザはまだ警告を出します。"
        echo "[gen-certs]    一度だけ手元のターミナルで実行してください: mkcert -install"
    fi

    mkcert -cert-file "$CERT_DIR/server.crt" \
           -key-file  "$CERT_DIR/server.key" \
           "$DOMAIN" "$ALT" "*.$ALT" 127.0.0.1 ::1 2>/dev/null

    echo "trusted-ca: mkcert (installed=$TRUSTED)" > "$CERT_DIR/provenance.txt"
else
    echo "[gen-certs] mkcert が見つかりません。openssl の自己署名へフォールバックします。"
    echo "[gen-certs] ⚠️ ブラウザは警告を出します。M2 のうち HSTS（010）は"
    echo "[gen-certs]    証明書エラーをバイパスした接続に HSTS が適用されないため測れません。"
    echo "[gen-certs]    その場合は mkcert を導入してから再実行してください。"
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -keyout "$CERT_DIR/server.key" \
        -out    "$CERT_DIR/server.crt" \
        -subj   "/CN=$DOMAIN" \
        -addext "subjectAltName=DNS:$DOMAIN,DNS:$ALT,DNS:*.$ALT,IP:127.0.0.1" \
        2>/dev/null
    echo "trusted-ca: none (self-signed)" > "$CERT_DIR/provenance.txt"
fi

{
    echo "generated-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "openssl: $(openssl version)"
} >> "$CERT_DIR/provenance.txt"

chmod 644 "$CERT_DIR/server.crt" "$CERT_DIR/server.key"
echo "[gen-certs] 完了: $CERT_DIR/server.{crt,key}"
