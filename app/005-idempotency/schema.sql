-- 記事 005 の共有ストア（PostgreSQL）。
-- 処理中のキーを主キーで確保する。2 本目の INSERT は一意制約に当たり、行は増えない。
-- status が NULL の行は「処理中」、値が入った行は「結果を保存済み」を表す。
CREATE TABLE idempotency_keys (
  key         text        PRIMARY KEY,
  fingerprint text        NOT NULL,
  status      integer,
  body        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
