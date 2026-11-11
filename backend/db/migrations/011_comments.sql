-- Mentorjevi komentarji k testu in označene napake (docs/03, US-14).
CREATE TABLE comments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  backtest_id bigint NOT NULL REFERENCES backtests (id) ON DELETE CASCADE,
  author_id   bigint NOT NULL REFERENCES users (id),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  is_mistake  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX comments_backtest_id_idx ON comments (backtest_id, id);
