# Node 24 系（LTS Krypton）。ホスト側の開発環境と系を揃える
FROM node:24.19.0-alpine

WORKDIR /srv

# 依存を先に入れてレイヤを効かせる
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.mjs"]
