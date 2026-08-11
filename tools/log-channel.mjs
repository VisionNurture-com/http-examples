// log-channel.mjs — 観測チャネル（nginx のアクセスログ）が生きていることを保証する
//
// 008 の測定は「preflight が飛んだか」をブラウザではなくサーバ側の到着記録で判定する。
// ブラウザから preflight のキャッシュを覗く手段がないためで、この設計自体は正しい。
//
// ただしチャネルが死ぬ経路がある。nginx は起動時にログを open したまま保持するため、
// コンテナを動かしたままホスト側でログファイルを置き換える（git checkout での復元、
// バックアップからの cp、rm など）と、nginx は削除済み inode へ書き続ける。
//
//   $ docker exec http-examples-edge ls -l /proc/<nginx>/fd
//   5 -> /results/008-cors-max-age/preflight.log (deleted)
//
// この状態で測定すると、到着記録が 1 行も増えないため **全ケースが「preflight なし」**
// になり、終了コードは 0 のまま通る。実測は 4/8 なのに 0/8 が出て、しかも誰も気づかない。
//
// 記事は「測ったこと」を価値の中心に置いている。測れていないのに測れたように見える経路は、
// 値が間違うより重い。そこで「チャネルが生きていること」を測定の事前条件として明示的に
// 検査し、死んでいれば黙って 0 を返さず落とす。
//
// 復旧: docker compose exec edge nginx -s reopen

import { readFileSync, existsSync } from "node:fs";

/** ログの現在行数。ファイルが無ければ 0。 */
export function logLineCount(path) {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split("\n").filter(Boolean).length;
}

/**
 * 測定の前後でログが 1 行も増えていなければ、観測チャネルが死んでいると判断して落とす。
 *
 * 測定中はどのシナリオも必ず本番リクエストをサーバへ届けるため、正常なら必ず増える。
 * 「増えなかった」は「preflight が飛ばなかった」ではなく「観測できていない」を意味する。
 *
 * @param {string} path   監視するログのパス
 * @param {number} before 測定開始前の行数（logLineCount で取得）
 * @param {string} ctx    エラーメッセージに出す測定名
 */
export function assertLogChannelLive(path, before, ctx) {
  const after = logLineCount(path);
  if (after > before) return;

  throw new Error(
    [
      `[${ctx}] 観測チャネルが死んでいます: ${path} が 1 行も増えていません（${before} 行のまま）。`,
      "",
      "測定はサーバ側の到着記録で preflight の有無を判定します。記録が増えていない以上、",
      "この実行結果は「preflight が飛ばなかった」ではなく「観測できていない」です。",
      "全ケースが偽の『preflight なし』になるため、結果を書き出さずに中止しました。",
      "",
      "よくある原因: コンテナを動かしたままホスト側でログを置き換えた（git checkout / cp / rm）。",
      "nginx が削除済み inode を掴んだままになります。次で確認できます。",
      "",
      "  docker exec http-examples-edge sh -c 'for p in $(ls /proc | grep -E \"^[0-9]+$\"); do \\",
      "    [ \"$(cat /proc/$p/comm 2>/dev/null)\" = nginx ] && ls -l /proc/$p/fd; done' | grep deleted",
      "",
      "復旧:",
      "",
      "  docker compose exec edge nginx -s reopen",
    ].join("\n")
  );
}
