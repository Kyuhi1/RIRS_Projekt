-- »Ponovi test« (US-12): nov test kaže na test, iz katerega je nastal (docs/03, previous_id).
ALTER TABLE backtests ADD COLUMN previous_id bigint REFERENCES backtests (id);

-- Iz enega testa nastane največ ena ponovitev (tudi pri sočasnih zahtevkih).
CREATE UNIQUE INDEX backtests_previous_id_idx ON backtests (previous_id) WHERE previous_id IS NOT NULL;
