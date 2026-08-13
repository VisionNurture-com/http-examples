# 003-prefetch

状態を変える GET を、ブラウザの先読みが踏むかを 3 エンジンで測ります。

## 何を測るか

`public/003/prefetch.html` は `rel="prefetch"` の対象として、トークンを 1 つ消費する GET を指しています。ページを開いて 5 秒待ち、消費数を読みます。

## 実行

```bash
docker compose up -d --wait
npx playwright install
bash scenarios/003-prefetch/run.sh
```

## 測り方の注意

- リンクは HTML に静的に置いています。JavaScript で後から差し込むと、踏まれなかったときに「エンジンが踏まない」のか「動的な差し込みが効かない」のか分けられなくなります
- エンジンごとに `POST /003/__reset` を挟み、消費数をそのエンジンに帰属させています
- 踏まなかったエンジンについて、記事に「先読みしない」とは書きません。測ったのは 1 つの経路だけです
