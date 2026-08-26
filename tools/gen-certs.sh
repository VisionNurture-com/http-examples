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

# --- 記事 001 用: 名前がわざと一致しない証明書 -------------------------------
#
# 🔴 mkcert は使わない。mkcert の CA は信頼ストアに入っているため、
#    「信頼できない CA」と「名前が一致しない」が混ざって層が分離できなくなる。
#    ここで測りたいのは名前の不一致だけなので、openssl の自己署名にする。
#
# other.invalid は RFC 6761 §6.4 が予約した TLD で、名前解決が必ず失敗する。
# 実在のホストと衝突しないため、証明書の名前としても安全に使える。
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$CERT_DIR/wrongname.key" \
    -out    "$CERT_DIR/wrongname.crt" \
    -subj   "/CN=other.invalid" \
    -addext "subjectAltName=DNS:other.invalid" \
    2>/dev/null
chmod 644 "$CERT_DIR/wrongname.crt" "$CERT_DIR/wrongname.key"

# --- 記事 001 用: 名前だけが一致しない証明書（CA は信頼される）-----------------
#
# 🔴 wrongname.crt は「自己署名」かつ「名前不一致」の 2 要因を同時に持つ。
#    2026-08-26 の実測で、curl は名前不一致を、openssl は自己署名（verify=18）を
#    報告し、同じ失敗を別の理由で説明した。層の中で要因が混ざっている。
#    mismatch.crt は mkcert（信頼ストアに入った CA）が other.example.test に対して
#    発行するため、localhost へ接続したときの失敗要因は名前不一致だけになる。
if command -v mkcert >/dev/null 2>&1; then
    mkcert -cert-file "$CERT_DIR/mismatch.crt" \
           -key-file  "$CERT_DIR/mismatch.key" \
           "other.${ALT}" 2>/dev/null
    chmod 644 "$CERT_DIR/mismatch.crt" "$CERT_DIR/mismatch.key"
    echo "[gen-certs] mismatch.crt を発行しました（CN=other.${ALT}・CA は信頼される）"
else
    # mkcert が無い環境では要因を分離できない。K4b は測れないと記録する。
    echo "[gen-certs] ⚠️ mkcert が無いため mismatch.crt を発行できません（001 の K4b は測定不可）"
fi

echo "[gen-certs] 完了: $CERT_DIR/server.{crt,key} / $CERT_DIR/wrongname.{crt,key} / $CERT_DIR/mismatch.{crt,key}"
