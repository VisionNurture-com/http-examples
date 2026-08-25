<?php
// 009 — FastCGI 経由で Authorization が届くかを見るだけの終端。
// 前段は nginx の fastcgi_pass（P3）と Apache の mod_proxy_fcgi（P9）の 2 通り。
// 🔴 スクリプトは複製しない。どちらから来たかは SERVER_SOFTWARE から導く。
//
// 🔴 資格情報の値は出さない。あるか / ないかと、スキーム名だけを返す。
declare(strict_types=1);

header('Content-Type: application/json');

$software = $_SERVER['SERVER_SOFTWARE'] ?? '';
$via = stripos($software, 'apache') !== false ? 'apache-proxy-fcgi' : 'nginx-fastcgi-php-fpm';

$raw = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$has = $raw !== '';
$scheme = $has ? explode(' ', $raw)[0] : null;

echo json_encode([
    'auth' => $has ? 'yes' : 'no',
    'scheme' => $scheme,
    'via' => $via,
], JSON_UNESCAPED_SLASHES), "\n";
