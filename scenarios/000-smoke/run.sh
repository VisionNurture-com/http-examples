#!/usr/bin/env bash
# mode: M1
# 000-smoke — app の応答と版を記録する
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/results/000-smoke"
mkdir -p "$OUT"

{
  echo "measured-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "docker: $(docker --version)"
  echo "compose: $(docker compose version --short 2>/dev/null || echo unknown)"
  echo "---"
} > "$OUT/run.log"

# nginx 経由で app の版情報を取る（80 番のみ・証明書に依存させない）
curl -sS --fail --max-time 10 http://localhost:8080/__meta | tee -a "$OUT/run.log"
echo "" >> "$OUT/run.log"

NODE_V="$(curl -sS --fail --max-time 10 http://localhost:8080/__meta | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).node))')"
EXPRESS_V="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).dependencies.express)' "$ROOT/app/package.json")"

OUT="$OUT" node -e '
const [node, express] = process.argv.slice(1);
const fs = require("fs");
fs.writeFileSync(process.env.OUT + "/summary.json", JSON.stringify({ app_node_version: node, app_express_version: express }, null, 2) + "\n");
' "$NODE_V" "$EXPRESS_V"

echo "[000-smoke] node=$NODE_V express=$EXPRESS_V"
