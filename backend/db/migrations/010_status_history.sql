-- Mentorski pregled testa: mentor (reviewer_id) in zgodovina prehodov stanja (docs/03, US-12).
-- previous_id (nadaljevanje testa po zahtevanih spremembah) doda migracija naloge »Ponovi test«.

ALTER TABLE backtests
  ADD COLUMN reviewer_id bigint REFERENCES users (id),
  -- Mentor je nastavljen ob oddaji; osnutek ga nima, umaknjen test ga obdrži, ker je bil že oddan.
  ADD CONSTRAINT backtests_reviewer_matches_status CHECK (status = 'withdrawn' OR (status = 'draft') = (reviewer_id IS NULL));

CREATE INDEX backtests_reviewer_id_idx ON backtests (reviewer_id, status);

CREATE TABLE status_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  backtest_id bigint NOT NULL REFERENCES backtests (id) ON DELETE CASCADE,
  from_status text NOT NULL CHECK (from_status IN ('draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'withdrawn')),
  to_status   text NOT NULL CHECK (to_status IN ('draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'withdrawn')),
  changed_by  bigint NOT NULL REFERENCES users (id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (from_status <> to_status)
);

CREATE INDEX status_history_backtest_id_idx ON status_history (backtest_id, id);
