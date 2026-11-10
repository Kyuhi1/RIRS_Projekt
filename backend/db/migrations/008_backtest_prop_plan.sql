-- Neobvezen načrt financiranega računa pri testu in izid preverjanja pravil (docs/03, US-08).
-- `challenge_passed` je prazen, če načrt ni izbran, sicer true (vsa tri pravila izpolnjena) ali false.
-- Podrobnosti po pravilih so v `results.challenge`.

ALTER TABLE backtests
  ADD COLUMN prop_plan_id     text REFERENCES prop_plans (id),
  ADD COLUMN challenge_passed boolean,
  ADD CONSTRAINT backtests_challenge_needs_plan CHECK ((prop_plan_id IS NULL) = (challenge_passed IS NULL));
