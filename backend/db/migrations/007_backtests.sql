-- Testi (backtests) in sredstva testov iz docs/03-podatkovni-model.md.
-- Test se shrani šele po uspešnem izračunu, zato je `results` obvezen. Polja za mentorski pregled
-- (reviewer_id, previous_id), financiran račun in zgodovino stanj dodajo migracije ustreznih nalog.

CREATE TABLE backtests (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint NOT NULL REFERENCES users (id),
  strategy_id bigint NOT NULL REFERENCES strategies (id),
  venue_id    text NOT NULL REFERENCES venues (id),
  period_from date NOT NULL,                       -- prvi dan obdobja (vključno, UTC)
  period_to   date NOT NULL,                       -- zadnji dan obdobja (vključno, UTC)
  params      jsonb NOT NULL DEFAULT '{}',         -- uporabljeni parametri strategije za ta test
  results     jsonb NOT NULL,                      -- metrike, stroški, dnevna krivulja in posli
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'withdrawn')),
  visibility  text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (period_from < period_to)
);

CREATE INDEX backtests_owner_id_idx ON backtests (owner_id, id);
CREATE INDEX backtests_strategy_id_idx ON backtests (strategy_id);

CREATE TABLE backtest_instruments (
  backtest_id bigint NOT NULL REFERENCES backtests (id) ON DELETE CASCADE,
  ticker      text NOT NULL REFERENCES instruments (ticker),
  PRIMARY KEY (backtest_id, ticker)
);
