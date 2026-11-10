-- Referenčne entitete iz docs/03-podatkovni-model.md (vzdržuje jih administrator).

CREATE TABLE instruments (
  ticker      text PRIMARY KEY,
  description text NOT NULL,
  asset_class text NOT NULL CHECK (asset_class IN ('crypto', 'forex', 'index', 'gold'))
);

CREATE TABLE venues (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  maker_pct  double precision NOT NULL DEFAULT 0 CHECK (maker_pct >= 0), -- delež vrednosti posla na stran
  taker_pct  double precision NOT NULL DEFAULT 0 CHECK (taker_pct >= 0),
  pay_spread boolean NOT NULL DEFAULT false                              -- plača izmerjeni razpon (bid-ask)
);

CREATE TABLE prop_plans (
  id             text PRIMARY KEY,
  firm_name      text NOT NULL,
  plan_name      text NOT NULL,
  account_size   double precision NOT NULL CHECK (account_size > 0),
  max_daily_loss double precision NOT NULL CHECK (max_daily_loss > 0),
  max_total_loss double precision NOT NULL CHECK (max_total_loss > 0),
  profit_target  double precision NOT NULL CHECK (profit_target > 0)
);

-- Pomožna tabela: izmerjeni razpon (bid-ask) po sredstvu in letu, v cenovnih enotah sredstva.
-- Uporablja jo simulator pri borzah s pay_spread = true.
CREATE TABLE spreads (
  ticker text NOT NULL REFERENCES instruments (ticker),
  year   smallint NOT NULL CHECK (year BETWEEN 1990 AND 2100),
  spread double precision NOT NULL CHECK (spread >= 0),
  PRIMARY KEY (ticker, year)
);
