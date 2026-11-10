-- Uporabniki platforme (docs/03). E-naslov se shrani z malimi črkami, zato je enoličen ne glede na velikost.
CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('trader', 'mentor', 'admin')),
  blocked       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
