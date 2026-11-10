-- Povezava mentor–trgovec z vabilom (docs/03, US-11).
-- Par (mentor_id, trader_id) je enoličen: vsak mentor lahko istega trgovca povabi samo enkrat, tudi po zavrnitvi ali prekinitvi.
-- Trgovec ima lahko največ eno aktivno povezavo (delni enolični indeks), kar zagotavlja pravilo »en aktiven mentor«.

CREATE TABLE mentor_links (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mentor_id  bigint NOT NULL REFERENCES users (id),
  trader_id  bigint NOT NULL REFERENCES users (id),
  status     text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'declined', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mentor_id, trader_id),
  CHECK (mentor_id <> trader_id)
);

CREATE UNIQUE INDEX mentor_links_one_active_mentor_idx ON mentor_links (trader_id) WHERE status = 'active';
CREATE INDEX mentor_links_trader_id_idx ON mentor_links (trader_id);
