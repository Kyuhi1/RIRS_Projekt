-- Strategije iz docs/03-podatkovni-model.md. Sistemske strategije nimajo lastnika (owner_id je NULL).

CREATE TABLE strategies (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id       bigint REFERENCES users (id),
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  source         text NOT NULL,                           -- koda: export default (bars, params) => trades[]
  default_params jsonb NOT NULL DEFAULT '{}',
  visibility     text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_id IS NOT NULL OR visibility = 'shared')   -- sistemske strategije so vidne vsem
);

CREATE INDEX strategies_owner_id_idx ON strategies (owner_id);
