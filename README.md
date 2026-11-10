# Backtesting-Tool

Spletna aplikacija za backtesting trgovalnih strategij nad zgodovinskimi podatki kriptovalut in ostalih finančnih sredstev. Platforma rezultate izboljša na podlagi simulacij, upoštevanja ekonomskih novic in stroškov ter pogojev financiranih računov.

Rešitev je namenjena strokovnjakom, ki želijo svoje znanje deliti z drugimi trgovalci različnih finančnih sredstev. Tem trgovalcem pa je omogočeno piljenje strategije z namenom doseganja in testiranja realnih rezultatov in identikacije profitabilnih strategij ter učenja.

## Dokumentacija

| Dokument | Vsebina |
|---|---|
| [docs/01-zasnova-resitve.md](docs/01-zasnova-resitve.md) | Zasnova, namen, problemi in ciljni uporabniki rešitve |
| [docs/02-funkcionalnosti-in-obseg.md](docs/02-funkcionalnosti-in-obseg.md) | Funkcionalnosti in obseg projekta |
| [docs/03-podatkovni-model.md](docs/03-podatkovni-model.md) | Podatkovni model (ER diagram in opis tabel) |
| [docs/04-arhitektura-in-tehnoloski-sklad.md](docs/04-arhitektura-in-tehnoloski-sklad.md) | Arhitektura, REST endpointi in tehnološki sklad |
| [docs/05-uporabniske-zgodbe.md](docs/05-uporabniske-zgodbe.md) | Uporabniške zgodbe |
| [docs/06-wireframes.md](docs/06-wireframes.md) | Wireframe prikaz dizajna spletne rešitve |
| [docs/adr/](docs/adr/) | Arhitekturne odločitve (ADR, predloga MADR) |

## Arhitektura
Aplikacija je sestavljena iz treh ločenih storitev (frontend, backend, baza), ki jih zažene Docker Compose. Brskalnik komunicira samo s frontendom (nginx), ta pa zahtevke na `/api/*` posreduje backendu. Samo backend se povezuje z bazo PostgreSQL in bere zgodovinske podatke formata Parquet.

## Uporabljene tehnologije
- **Frontend:** TypeScript, Vite, nginx server
- **Backend:** Node.js 24, TypeScript, REST API, JWT token, BCrypt
- **Podatki:** PostgreSQL 16, Parquet in DuckDB
- **Skripte:** Python
- **Okolje:** Docker in Docker Compose virtualno okolje

## Lokalni zagon

Potrebuješ Docker z Docker Compose.

1. Ustvari datoteko z nastavitvami: `cp .env.example .env` in v njej nastavi geslo baze (`POSTGRES_PASSWORD`). Datoteka `.env` je v `.gitignore` in se ne commita.
2. Zaženi vse tri storitve: `docker compose up --build`
3. Odpri aplikacijo na `http://localhost:18080`.
4. Preveri backend: `curl http://localhost:18080/api/health` vrne `{"status":"ok"}`.

Ustavitev: `docker compose down` (podatki baze ostanejo v volumnu `pgdata`, `docker compose down -v` jih izbriše).

Če so vrata 18080 na tvojem računalniku zasedena, jih spremeni v `docker-compose.yml` (`ports` pri storitvi `frontend`).

## Baza in migracije

Ob zagonu backend po vrsti (po imenu datoteke) izvede SQL migracije iz `backend/db/migrations/` (`001_init.sql`, `002_...sql`, ...). Izvedene so zabeležene v tabeli `schema_migrations`, zato se vsaka izvede samo enkrat. Novo spremembo sheme dodaš kot novo datoteko z naslednjo številko, obstoječih migracij ne spreminjaj.

## Referenčni podatki

Migraciji `002_reference_tables.sql` in `003_seed_reference_data.sql` ustvarita tabele `instruments`, `venues`, `prop_plans` in `spreads` (po docs/03) in jih ob prvem zagonu prazne baze napolnita. Ker se migracija izvede samo enkrat, se podatki ob ponovnem zagonu ne podvajajo. Administratorjeve kasnejše spremembe se ne prepišejo.

Podatki so preneseni iz projekta PTS (Backtesting-Tool): 27 sredstev, 5 borz, 5 načrtov financiranih računov in 111 letnih razponov (bid-ask) iz `spreads.json`. Preslikava:

- `instruments.asset_class`: `crypto`, `forex`, `index` (NAS100), `gold` (XAUUSD).
- `venues`: samo `maker_pct`, `taker_pct` (delež vrednosti posla na stran, 0 = brez) in `pay_spread`. Provizije po sredstvih iz PTS niso del modela.
- `prop_plans`: `firm_name` in `plan_name` iz imena načrta, `profit_target` je cilj prve faze. Prenesli so se samo načrti, ki imajo vsa tri pravila (cilj dobička, dnevna in skupna izguba), ker jih zahteva US-08.
- `spreads (ticker, year, spread)`: razpon v cenovnih enotah sredstva. Uporablja ga simulator pri borzah s `pay_spread = true`.

Read-only endpointi (samo `GET`, drugi načini vrnejo `405`): `/api/instruments`, `/api/venues`, `/api/prop-plans`.

## Testiranje

Testi se izvajajo v containerju backenda, ker ta doseže bazo:

```
docker compose run --rm --build backend npm test
```

Zastavica `--build` poskrbi, da se image pred zagonom osveži. Ukaz zažene bazo (če še ne teče), za vsak test ustvari začasno bazo (`test_...`), požene teste z vgrajenim `node --test` in bazo po testu izbriše. Tipe preveriš z `npm run typecheck` v mapi `backend`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) ob vsakem pushu in pull requestu zažene tipski preizkus, teste backenda in build frontenda. Da neuspeh prepreči merge, je v nastavitvah repozitorija (Settings, Branches) za `main` nastavljeno pravilo, ki zahteva uspešno preverjanje `ci`.

