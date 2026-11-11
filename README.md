# Backtesting-Tool

## 1. Opis

Spletna aplikacija za backtesting trgovalnih strategij nad zgodovinskimi podatki kriptovalut in ostalih finančnih sredstev. Rešitev je namenjena trgovcem, ki svoje strategije preizkušajo na preteklih podatkih in jih po potrebi delijo z drugimi, ter mentorjem, ki njihove teste pregledujejo.

| Vloga | Kaj lahko |
|---|---|
| **Trader** | naloži strategijo, zažene test (izbira sredstev, obdobja, borze, načrta financiranega računa), primerja teste, deli strategije in teste, test odda mentorju |
| **Mentor** | povabi učence, pregleduje oddane teste, komentira jih in odloči (odobri ali zahteva spremembe), spremlja analitiko učencev |
| **Admin** | vzdržuje referenčne podatke (sredstva, borze, načrte financiranih računov) in uporabniške račune |

## 2. Arhitektura

```
Brskalnik ──► frontend (nginx, :18080) ──/api/*──► backend (Node.js, :3000) ──► PostgreSQL
                                                         └──► data/*.parquet (DuckDB, samo branje)
```

Tri ločene storitve, ki jih zažene Docker Compose. Brskalnik govori samo z nginxom, samo backend dostopa do baze in do Parquet datotek s cenami. Vloge se preverjajo na backendu (ADR 0005), strategije se izvajajo v izoliranem delavcu (ADR 0008). Podrobnosti so v [docs/04](docs/04-arhitektura-in-tehnoloski-sklad.md) in [docs/07](docs/07-implementacijska-dokumentacija.md).

## 3. Tehnologije

- **Frontend:** TypeScript, Vite, nginx (design system s CSS tokeni, light/dark tema, pisava Inter)
- **Backend:** Node.js 24, TypeScript (`node:http`), JWT v `httpOnly` piškotku, bcrypt
- **Podatki:** PostgreSQL 16 (oštevilčene SQL migracije), Parquet in DuckDB za cene
- **Okolje:** Docker, Docker Compose, GitHub Actions

## 4. Navodila za zagon

Potrebuješ Docker z Docker Compose.

```bash
cp .env.example .env          # vzorčne vrednosti delujejo, za resno uporabo jih zamenjaj
docker compose up --build     # dodaj -d za ozadje
```

- Aplikacija: **http://localhost:18080**
- Preverjanje backenda: `curl http://localhost:18080/api/health` vrne `{"status":"ok"}`
- Ustavitev: `docker compose down` (`docker compose down -v` izbriše tudi bazo)
- Če so vrata 18080 zasedena, jih spremeni v `docker-compose.yml` (`ports` pri storitvi `frontend`).

Ob prvem zagonu backend ustvari shemo in referenčne podatke ter administratorja iz `.env`. Cenovni podatki za BTCUSDT in EURUSD so že v repozitoriju (poglavje 5). Za demo uporabnike in teste izvedi še seedanje.

## 5. Navodila za seedanje

**Referenčni podatki** (27 sredstev, 5 borz, 5 načrtov financiranih računov, razponi) se naložijo samodejno z migracijami ob prvem zagonu prazne baze. Ročno ni treba narediti ničesar.

**Cenovni podatki** so v repozitoriju v mapi `data/`:

| Mapa | Sredstvo | Obdobje | Velikost |
|---|---|---|---|
| `data/BTCUSDT/` | Bitcoin / USDT (spot) | 2025-01 do 2025-12, mesečne datoteke | ~22 MB |
| `data/EURUSD/` | EUR / USD | 2025-01 do 2025-12, mesečne datoteke | ~8 MB |

Format: `data/<TICKER>/<LLLL-MM>.parquet`, minutne svečke s stolpci `open_time` (ms od 1970, UTC), `open`, `high`, `low`, `close`, `volume`. Mapo priklopi `docker-compose.yml` v backend kot `/data` (samo za branje). Podatki se berejo ob vsakem zahtevku, zato po dodajanju datotek ponovni zagon ni potreben. Za testiranje strategij zadošča izbrano obdobje v letu 2025. Sredstva brez podatkov imajo v `GET /api/instruments` `candles: 0`.

Preverjanje (endpoint zahteva prijavo):

```bash
curl -s -c /tmp/c.txt -X POST http://localhost:18080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"spremeni-me-admin"}'
curl -s -b /tmp/c.txt http://localhost:18080/api/instruments    # BTCUSDT in EURUSD: candles > 0
```

Dodatne podatke dodaš v isto strukturo (npr. `data/ETHUSDT/2025-01.parquet`). Samo `2025-*.parquet` v mapah `BTCUSDT` in `EURUSD` sledi Git, vse ostalo v `data/` je v `.gitignore`, da se velike datoteke ne naložijo po pomoti (`.gitignore` prilagodi, če želiš dodati še kaj).

**Demo uporabniki in testi.** Ko aplikacija teče, v mapi `backend` zaženi (zahteva Node.js 24):

```bash
cd backend
npm run seed:demo                                  # privzeto http://localhost:18080
node scripts/seed-demo.ts http://localhost:18080   # enako, z ročnim naslovom
```

Skripta prek javnega API-ja (enako kot uporabnik v brskalniku) ustvari demo trgovca, demo mentorja in aktivno povezavo med njima. Demo trgovec dobi šest testov, po enega v vsakem stanju (`draft`, `submitted`, `in_review`, `changes_requested`, `approved`, `withdrawn`). Skripta je idempotentna: če demo trgovec že ima teste, ne naredi ničesar. Če podatkov v `data/` ni, ustvari samo račune in se ustavi z jasnim sporočilom.

## 6. Navodila za testiranje

```bash
docker compose run --rm --build backend npm test    # backend testi (node --test)
cd backend && npm run typecheck                     # tipi backenda
cd frontend && npm run build                        # tipi in build frontenda
```

Prvi ukaz zažene bazo (če še ne teče), za vsak testni fajl ustvari začasno bazo `test_...` in jo po testu izbriše. Testi si sami ustvarijo majhno količino cenovnih podatkov, zato od `data/` niso odvisni. Frontend nima avtomatskih testov, zasloni so preverjeni ročno v brskalniku.

## 7. Dokumentacija

| Dokument | Vsebina |
|---|---|
| [docs/01-zasnova-resitve.md](docs/01-zasnova-resitve.md) | Zasnova, namen in ciljni uporabniki |
| [docs/02-funkcionalnosti-in-obseg.md](docs/02-funkcionalnosti-in-obseg.md) | Funkcionalnosti in obseg |
| [docs/03-podatkovni-model.md](docs/03-podatkovni-model.md) | Podatkovni model |
| [docs/04-arhitektura-in-tehnoloski-sklad.md](docs/04-arhitektura-in-tehnoloski-sklad.md) | Arhitektura in tehnološki sklad |
| [docs/05-uporabniske-zgodbe.md](docs/05-uporabniske-zgodbe.md) | Uporabniške zgodbe z merili sprejemljivosti |
| [docs/06-wireframes.md](docs/06-wireframes.md) | Wireframi |
| [docs/07-implementacijska-dokumentacija.md](docs/07-implementacijska-dokumentacija.md) | Podrobnosti implementacije: pravila simulacije, API-ji, vloge, frontend, znana odstopanja |
| [docs/adr/](docs/adr/) | Arhitekturne odločitve (ADR) |

## 8. Seznam endpointov

Vsi endpointi so pod `/api`. Napake: `401` brez seje, `403` vidno, a nedovoljeno, `404` skrit ali neobstoječ objekt, `409` napačno stanje, `405` nepodprta metoda. Stolpec Vloga pove, kdo sme klicati.

| Metoda | Pot | Vloga | Opis |
|---|---|---|---|
| GET | `/health` | javno | Stanje backenda |
| POST | `/auth/register` | javno | Registracija (trader ali mentor) |
| POST | `/auth/login` | javno | Prijava, nastavi `httpOnly` piškotek |
| POST | `/auth/logout` | javno | Odjava |
| GET | `/auth/me` | vse | Prijavljeni uporabnik |
| GET | `/instruments` | vse | Sredstva z razponom podatkov (`data_from`, `data_to`, `candles`) |
| GET | `/venues` | vse | Borze s provizijami |
| GET | `/prop-plans` | vse | Načrti financiranih računov |
| GET | `/strategies` | vse | Seznam strategij |
| GET | `/strategies/:id` | vse | Podrobnosti strategije |
| POST | `/strategies` | trader | Naloži strategijo |
| PATCH | `/strategies/:id` | trader | Uredi lastno strategijo |
| DELETE | `/strategies/:id` | trader | Izbriši lastno strategijo |
| PUT | `/strategies/:id/visibility` | trader | Deli ali prekliči deljenje strategije |
| GET | `/strategy-catalog` | trader | Katalog strategij z iskanjem in filtri (strani po 20) |
| GET | `/backtests` | trader | Seznam testov (`scope=mine` ali `shared`) |
| POST | `/backtests` | trader | Zažene test |
| GET | `/backtests/compare` | trader | Primerjava testov (`ids=1,2,3`) |
| GET | `/backtests/:id` | trader, mentor | Rezultat testa (rezultati so nespremenljivi, `PUT`/`PATCH` ju zavrneta) |
| GET | `/backtests/:id/trades` | trader, mentor | Posli testa po straneh |
| PUT | `/backtests/:id/visibility` | trader | Deli ali prekliči deljenje testa |
| POST | `/backtests/:id/submit` | trader | Odda test mentorju |
| POST | `/backtests/:id/withdraw` | trader | Umakne oddan test |
| POST | `/backtests/:id/retest` | trader | Ustvari nov osnutek z istimi nastavitvami |
| GET | `/backtests/:id/comments` | trader, mentor | Komentarji testa |
| POST | `/backtests/:id/comments` | mentor | Doda komentar (lahko kot napako) |
| POST | `/backtests/:id/start-review` | mentor | Začne pregled |
| POST | `/backtests/:id/request-changes` | mentor | Zahteva spremembe |
| POST | `/backtests/:id/approve` | mentor | Odobri test |
| GET | `/mentor/backtests` | mentor | Čakalna vrsta testov učencev (`status`, `page`) |
| GET | `/mentor/students` | mentor | Učenci s številom testov |
| GET | `/mentor/students/analytics` | mentor | Skupna analitika učencev (`period=all`, `30` ali `90`) |
| GET | `/mentor-links` | mentor, trader | Povezave mentor–trgovec |
| POST | `/mentor-links` | mentor | Povabi trgovca po e-naslovu |
| POST | `/mentor-links/:id/accept` | trader | Sprejme vabilo |
| POST | `/mentor-links/:id/decline` | trader | Zavrne vabilo |
| POST | `/mentor-links/:id/end` | mentor, trader | Prekine povezavo |
| GET, POST | `/admin/{instruments,venues,prop-plans}` | admin | Seznam z iskanjem in dodajanje referenčnih zapisov |
| PUT, DELETE | `/admin/{instruments,venues,prop-plans}/:key` | admin | Urejanje in brisanje zapisa (brisanje ni mogoče, če ga uporablja test) |
| GET, POST | `/admin/users` | admin | Seznam uporabnikov (strani po 20) in ustvarjanje računa |
| PATCH | `/admin/users/:id` | admin | Sprememba vloge ali blokada |

## 9. Seznam testnih računov

Vsi računi so definirani v repozitoriju (`backend/src/demoSeed.ts` in `.env.example`).

| Račun | Vloga | Geslo | Nastane |
|---|---|---|---|
| `demo.trader@example.com` | trader | `Demo-geslo-123` | `npm run seed:demo` |
| `demo.mentor@example.com` | mentor (aktivna povezava z demo trgovcem) | `Demo-geslo-123` | `npm run seed:demo` |
| `admin@example.com` | admin | `spremeni-me-admin` | samodejno ob zagonu (vrednosti iz `.env`) |

Računi so namenjeni samo razvoju in predstavitvi. Pri resni uporabi zamenjaj `ADMIN_EMAIL` in `ADMIN_PASSWORD` v `.env`.

## 10. Datoteka `.env`

Vzorec je v `.env.example`, sama `.env` je v `.gitignore` in se ne commita. Ustvariš jo z `cp .env.example .env`.

| Spremenljivka | Pomen | Vzorčna vrednost |
|---|---|---|
| `POSTGRES_USER` | uporabnik baze | `backtester` |
| `POSTGRES_PASSWORD` | geslo baze (brez znakov `@ / : #`, ker je del `DATABASE_URL`) | `spremeni-me` |
| `POSTGRES_DB` | ime baze | `backtester` |
| `JWT_SECRET` | podpis seje, najmanj 32 znakov (`openssl rand -hex 32`); brez nje backend ne zažene | vzorčni niz |
| `ADMIN_EMAIL` | e-naslov administratorja, ustvarjen ob zagonu, če še ne obstaja | `admin@example.com` |
| `ADMIN_PASSWORD` | začetno geslo administratorja (najmanj 8 znakov) | `spremeni-me-admin` |

Docker Compose iz njih sestavi `DATABASE_URL` in nastavi `DATA_DIR=/data` za backend.

## 11. CI pipeline

GitHub Actions (`.github/workflows/ci.yml`) teče ob vsakem pushu in pull requestu na en job `ci` (Ubuntu, Node.js 24, storitev PostgreSQL 16):

1. **Backend:** `npm ci`, `npm run typecheck`, `npm test`
2. **Frontend:** `npm ci`, `npm run build` (tipi in produkcijski build)

Pravilo za veji `main` (Settings, Branches) zahteva uspešno preverjanje `ci` pred združitvijo.

## 12. Preverjanje meril sprejemljivosti

Merila iz [docs/05-uporabniske-zgodbe.md](docs/05-uporabniske-zgodbe.md) pokrivajo avtomatski testi backenda (`backend/src/*.test.ts`) in ročni preizkus zaslonov v brskalniku.

| Zgodba | Glavni testi |
|---|---|
| US-01 Registracija | `register.test.ts` |
| US-02 Prijava, vloge | `login.test.ts`, `guards.test.ts`, `app.test.ts` |
| US-03 Pregled strategij | `strategyCatalog.test.ts`, `strategies.test.ts` |
| US-04 Nalaganje strategije | `strategyUpload.test.ts`, `strategiesCreate.test.ts`, `strategiesManage.test.ts`, `strategy.test.ts` |
| US-05 Zagon testa | `backtestsApi.test.ts`, `backtestSchema.test.ts`, `candles.test.ts` |
| US-06 Rezultati | `simulation.test.ts`, `backtest.test.ts` |
| US-07 Stroški borze | `simulation.test.ts`, `reference.test.ts` |
| US-08 Pravila financiranega računa | `propRules.test.ts` |
| US-09 Primerjava | `backtestCompare.test.ts` |
| US-10 Deljenje | `backtestSharing.test.ts`, `strategyCatalog.test.ts` |
| US-11 Povezava mentor–trgovec | `mentorLinks.test.ts` |
| US-12 Oddaja testa | `testStatus.test.ts`, `backtestReview.test.ts`, `retest.test.ts` |
| US-13 Mentorjev dashboard | `mentorReview.test.ts`, `backtestAccess.test.ts` |
| US-14 Komentarji in odločitev | `comments.test.ts` |
| US-15 Analitika | `mentorAnalytics.test.ts` |
| US-16 Referenčni podatki | `adminReference.test.ts`, `reference.test.ts` |
| US-17 Uporabniški računi | `adminUsers.test.ts` |

Znana odstopanja in omejitve so v [docs/07](docs/07-implementacijska-dokumentacija.md#znana-odstopanja-in-omejitve).

## 13. Skladnost z ADR in wireframes

### ADR

| ADR | Ugotovitev |
|---|---|
| 0001 Sklad | Skladno: Vite + TS, Node 24 + TS, PostgreSQL, DuckDB. |
| 0002 PostgreSQL | Skladno: relacijski podatki v PostgreSQL z oštevilčenimi migracijami. |
| 0003 Parquet | Skladno: cene so v Parquet datotekah, branje prek DuckDB, mapa `data/` je v containerju samo za branje. |
| 0004 Tri storitve | Skladno: frontend (nginx), backend, baza; brskalnik govori samo z nginxom. |
| 0005 Vloge na backendu | Skladno: vsaka pot je zavarovana z `guarded(roles, ...)`, skrivanje menijev na frontendu ni varnostni mehanizem. |
| 0006 JWT v `httpOnly` | Skladno: žeton je v piškotku `HttpOnly; SameSite=Lax`. Odstopanje: backend ob vsakem zahtevku prebere uporabnika, vlogo in `blocked` iz baze (zahteva US-17), zato sprememba vloge ali blokada velja od naslednjega zahtevka. |
| 0007 Izvajalec brez dostopa do baze | Skladno: simulacija je čista funkcija; backend pripravi svečke in pravila, delavec (`strategyWorker.ts`) vrne samo rezultat. |
| 0008 Izolirano izvajanje strategij | Skladno: strategija teče v delavcu z omejitvijo časa in pomnilnika. Izolacija ni popolna varnostna meja. |

### Wireframes

Zasloni ustrezajo `docs/wireframes/WF-01..WF-06`. Ker so wireframi skica, so zavestne razlike naslednje:

| Wireframe | Razlika v implementaciji |
|---|---|
| vsi | Brez globalnega iskanja, avatarja, izbire jezika, noge strani ter zavihkov »News« in »Portfolio« (zunaj obsega MVP). Dodana sta tema (light/dark) in design system. |
| WF-01 Prijava/registracija | Prijava in registracija sta na ločenih zaslonih (`#prijava`, `#registracija`). |
| WF-02 Nov test | Dodani so filtri strategij (Vse/Moje/Sistemske/Deljene) in sprotni povzetek izbire; načrt financiranega računa je neobvezen. |
| WF-03 Rezultati | Primerjava se začne iz seznama zagonov (kljukice), ne iz strani rezultatov. |
| WF-04 Mentor dashboard | Dashboard združuje učence, vabilo, zagone za pregled in analitiko; strani »Učenci« in »Analitika« prikažeta vsaka svoj del. |
| WF-05 Pregled testa | Komentarji in odločitev sta v enem razdelku pod rezultati. |
| WF-06 Administracija | Zavihek »Database« je v meniju poimenovan »Referenčni podatki«; poleg tega je zavihek »Uporabniki«. |
