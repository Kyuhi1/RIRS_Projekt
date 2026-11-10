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

1. Ustvari datoteko z nastavitvami: `cp .env.example .env` in v njej nastavi geslo baze (`POSTGRES_PASSWORD`), skrivnost za JWT (`JWT_SECRET`, najmanj 32 znakov, npr. `openssl rand -hex 32`) ter administratorski račun (`ADMIN_EMAIL`, `ADMIN_PASSWORD`). Datoteka `.env` je v `.gitignore` in se ne commita.
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

## Zgodovinski podatki (Parquet)

Cenovni podatki (svečke) niso v bazi, ampak v datotekah Parquet, ki jih backend bere z DuckDB (ADR 0003). Mapa `data/` je v `.gitignore` in jo `docker compose` priklopi v backend kot `/data` (samo za branje).

Struktura: `data/<TICKER>/*.parquet`. Ime mape je `ticker` sredstva iz `GET /api/instruments` (npr. `BTCUSDT`, `BTCUSDT.P`, `EURUSD`). Datoteke so minutne svečke s stolpci `open_time` (BIGINT, ms od 1970, UTC), `open`, `high`, `low`, `close`, `volume`. Dodatni stolpci niso moteči.

Nalaganje podatkov iz projekta PTS (primer za nekaj sredstev, vsi podatki skupaj imajo okoli 3 GB, zato za razvoj zadošča nekaj sredstev):

```
PTS=<pot do PTS>/Backtesting-Tool/00_Data
mkdir -p data/BTCUSDT data/BTCUSDT.P data/EURUSD data/NAS100
cp "$PTS"/00_Binance/spot/BTCUSDT/1m/*.parquet data/BTCUSDT/
cp "$PTS"/00_Binance/um/BTCUSDT/1m/*.parquet data/BTCUSDT.P/
cp "$PTS"/01_Dukascopy/EURUSD/1m/*.parquet data/EURUSD/
cp "$PTS"/01_Dukascopy/USATECHIDXUSD/1m/*.parquet data/NAS100/
```

Preverjanje: `curl http://localhost:18080/api/instruments` za vsako sredstvo vrne `candles` (število svečk) ter `data_from` in `data_to` (celoten razpon podatkov). Sredstva brez podatkov imajo `candles: 0` in `null` razpon. Podatki se berejo ob vsakem zahtevku, zato po dodajanju datotek ponovni zagon ni potreben.

Brez mape `data/` se aplikacija normalno zažene, samo da nobeno sredstvo nima podatkov. Testi si sami ustvarijo majhno količino podatkov (dva dni minutnih svečk), zato za teste in CI pravi podatki niso potrebni.

## Registracija

`POST /api/auth/register` (JSON) ustvari uporabnika v tabeli `users`:

| Polje | Pravilo |
|---|---|
| `name` | obvezno (ime in priimek) |
| `email` | veljavna oblika; shrani se z malimi črkami in je enoličen |
| `password` | najmanj 8 znakov (največ 72 bajtov, ker bcrypt daljšega ne upošteva) |
| `role` | `trader` ali `mentor`, vloge `admin` ni mogoče izbrati (tudi z neposrednim klicem API-ja) |

Geslo se shrani samo kot bcrypt zgoščena vrednost (`bcryptjs`, cost 10), `blocked` je ob registraciji `false`. Odgovori: `201` z `{ id, email, name, role }`, `400` pri neveljavnih podatkih in `409` pri že obstoječem e-naslovu. Napake so oblike `{ "errors": { "<polje>": "<sporočilo>" } }`, frontend jih prikaže ob ustreznem polju.

Frontend (`http://localhost:18080`) ima po wireframu WF-01 obrazec za registracijo. Po uspešni registraciji se uporabnik preusmeri na panel »Prijava« s potrditvenim sporočilom. Prijava je opisana v poglavju spodaj.

## Prijava, odjava in vloge

| Pot | Opis |
|---|---|
| `POST /api/auth/login` | `{ email, password }`. `200` z `{ id, email, name, role }` in piškotkom `token`; `401` »Napačen e-naslov ali geslo« (enako za napačno geslo in neznan e-naslov, brez piškotka); `403` »Račun je blokiran« (pravilno geslo, blokiran račun) |
| `POST /api/auth/logout` | izbriše piškotek |
| `GET /api/auth/me` | prijavljeni uporabnik; brez prijave `401` |
| `GET /api/admin/users` | seznam uporabnikov, samo vloga `admin` |

Seja je JWT (HS256, veljavnost 1 ura), podpisan z `JWT_SECRET`, v piškotku `httpOnly; SameSite=Lax` (ADR 0006). Backend ob vsakem zahtevku uporabnika prebere iz baze, zato blokiran račun izgubi dostop takoj, vloga pa se vedno vzame iz baze, ne iz žetona (ADR 0005). Zaščitene poti (`/api/instruments`, `/api/venues`, `/api/prop-plans`, `/api/auth/me`) brez prijave vrnejo `401`, pot druge vloge pa `403`. Javni sta samo `/api/health` in `/api/auth/*` (prijava, odjava, registracija). Piškotek nima zastavice `Secure`, ker lokalni zagon teče prek `http`; za produkcijo jo je treba dodati ob HTTPS.

Administratorski račun backend ob zagonu ustvari iz `ADMIN_EMAIL` in `ADMIN_PASSWORD`. Če račun s tem e-naslovom že obstaja, mu nastavi vlogo `admin` in ga odblokira, gesla pa ne spremeni. Če spremenljivki nista nastavljeni, admin ni ustvarjen.

Frontend po prijavi preusmeri uporabnika glede na vlogo: Trgovec na Strategije, Mentor na Dashboard, Administrator na Database. Glava prikazuje navigacijo vloge (Trgovec: Strategije, Backtests, Mentor; Mentor: Dashboard, Učenci, Analitika; Administrator: Database) in uporabniški meni z odjavo. Neprijavljen uporabnik je preusmerjen na prijavo. Preverjanje v brskalniku je samo udobje, dostop dejansko odloča backend.

## Simulacija

Simulator (`backend/src/simulation.ts`, funkcija `simulate`) iz poslov strategije, borze in začetnega kapitala izračuna metrike, stroške in dnevno krivuljo vrednosti računa. Ne uporablja baze: borzo in razpone dobi kot vhodne podatke (vrednosti iz tabel `venues` in `spreads`).

### Pogodba strategije

```ts
export default (bars, params) => trades[]
```

Posel je `{ side, entryTime, exitTime, entryPrice, exitPrice, orderType }`:

| Polje | Pomen |
|---|---|
| `side` | `long` ali `short` |
| `entryTime`, `exitTime` | čas vstopa in izstopa v ms od 1970 (UTC) |
| `entryPrice`, `exitPrice` | ceni vstopa in izstopa, večji od 0 |
| `orderType` | `maker` ali `taker`, privzeto `taker` |

Posli enega sredstva se ne smejo prekrivati (naslednji vstop ni pred prejšnjim izstopom) in morajo biti znotraj obdobja testa, sicer simulator vrne napako.

### Pravila simulacije

- **Velikost pozicije:** celoten kapital sredstva, brez vzvoda: `količina = kapital sredstva / entryPrice`. Kapital sredstva se ob vsakem poslu vzame ponovno iz začetne vrednosti, zato velikost posla ne zavisi od prejšnjih dobičkov ali stroškov in je bruto dobiček pri vseh borzah enak.
- **Več sredstev:** začetni kapital se razdeli enakomerno (`kapital / število sredstev`).
- **Dobiček posla (bruto):** `smer * (exitPrice - entryPrice) * količina`, kjer je smer +1 za `long` in −1 za `short`.
- **Provizija:** `maker_pct` pri `orderType = maker` in `taker_pct` pri `taker`, kot delež vrednosti posla na stran: `pct * količina * (entryPrice + exitPrice)`.
- **Razpon:** pri borzi s `pay_spread = true` se pri vsakem poslu enkrat odšteje `razpon * količina`. Razpon je v ceni sredstva in se vzame iz tabele `spreads` za sredstvo in leto vstopa (UTC). Če podatka ni, simulator vrne napako. Pri `pay_spread = false` se razpon ne upošteva.
- **Neto:** neto dobiček posla = bruto − provizija − razpon.

### Metrike

| Metrika | Definicija |
|---|---|
| Bruto dobiček | vsota bruto dobičkov vseh poslov |
| Skupni stroški | vsota provizij in razponov (rezultat jih vrne tudi ločeno: `costs.commission`, `costs.spread`) |
| Neto dobiček | bruto dobiček − skupni stroški |
| Donosnost (%) | `neto dobiček / začetni kapital * 100` |
| Število poslov | število vseh poslov vseh sredstev |
| Delež dobičkonosnih poslov (%) | `posli z neto dobičkom > 0 / vsi posli * 100`, 0 brez poslov |
| Največji padec kapitala (%) | največji padec od vrha do dna na dnevni krivulji: `max((vrh − vrednost) / vrh * 100)`, kjer je vrh največja dosedanja vrednost (vključno z začetnim kapitalom) |

### Dnevna krivulja

`equityCurve` ima točko `{ date, value }` za vsak dan obdobja testa od prvega do zadnjega (UTC). Vrednost dneva je vsota stanj sredstev ob koncu dneva. Stanje sredstva se spremeni na dan izstopa posla za neto dobiček posla (krivulja prikazuje realizirane rezultate, odprte pozicije se ne vrednotijo po tržni ceni). Dnevi brez poslov prenesejo prejšnje stanje.

## Izolirano izvajanje strategij

Strategijo naloži uporabnik, zato je njena koda nezaupanja vredna (ADR 0007, ADR 0008). `runStrategy(source, bars, params)` v `backend/src/strategy.ts` jo izvede takole:

- **Ločen delavec:** vsak zagon ustvari nov `worker_thread` (`strategyWorker.ts`). Delavec ne uvaža nobenega modula backenda, zato nima povezave z bazo ali datotekami, in dobi prazno okolje (brez `DATABASE_URL`, `JWT_SECRET` ...). Podatki iz baze in svečke pridejo od backenda, delavec pa vrne samo posle.
- **Prazen `vm` kontekst:** strategija vidi samo vgrajene objekte JavaScripta (`Math`, `JSON`, `Array` ...), ne pa `process`, `require`, `fetch`, `Buffer`, časovnikov, datotek ali `import` modulov. `eval` in `new Function` sta onemogočena. Svečke in parametri gredo v kontekst in rezultat iz njega samo kot nizi JSON, zato strategija ne dobi referenc na objekte delavca.
- **Čas:** strategija, ki teče dlje od 60 s, se prekine (`vm` omejitev znotraj delavca in zunanji časovnik).
- **Pomnilnik:** delavec ima omejitev 128 MB. Če jo preseže, se konča samo ta delavec, backend teče naprej.
- **Napake:** uporabnik dobi razumljivo sporočilo (`StrategyError`): napaka strategije (samo besedilo napake, brez sledi sklada), prekoračitev časa ali pomnilnika. Notranje napake se zapišejo samo v dnevnik strežnika.

Oblika strategije je `export default (bars, params) => trades[]` (glej poglavje »Simulacija«); sinhrona funkcija, ki vrne seznam poslov.

Omejitve: izolacija znotraj procesa Node.js ni popolna varnostna meja (ADR 0008); varuje pred napakami, neskončnimi zankami in dostopom do virov, ni pa zasnovana proti odločnemu napadalcu z izkoriščanjem napak v Node.js ali V8. Svečke se v delavec prenesejo kot JSON, zato je za zelo dolga obdobja pomnilniško potratno.

## Strategije

Tabela `strategies` (migracija `005_strategies.sql`) hrani strategije: lastnik (`owner_id`), ime, opis, kodo (`source`, oblika v poglavju »Simulacija«), privzete parametre (`default_params`, JSON) in vidnost (`private` ali `shared`). **Sistemske strategije nimajo lastnika** (`owner_id` je `NULL`) in so vedno deljene, kar zagotavlja omejitev `CHECK` v bazi. Migracija `006_seed_system_strategies.sql` naloži tri sistemske strategije:

| Strategija | Opis | Privzeti parametri |
|---|---|---|
| Buy & Hold | kupi ob prvi svečki in drži do konca obdobja | / |
| SMA Crossover | long, ko hitro drseče povprečje preseže počasnega, izstop ob obratu | `fast` 10, `slow` 30 |
| Breakout (Donchian) | long ob preboju najvišje cene zadnjih `period` svečk, izstop pod najnižjo ceno zadnjih `exitPeriod` svečk | `period` 20, `exitPeriod` 10 |

Vstopi in izstopi so ob odprtju svečke po signalu, odprta pozicija se zapre ob zaprtju zadnje svečke. Sistemske strategije se izvajajo v delavcu kot vsaka druga (poglavje »Izolirano izvajanje strategij«), test v `systemStrategies.test.ts` preveri, da vsaka vrne posle, ki jih simulator sprejme.

| Pot | Opis |
|---|---|
| `GET /api/strategies` | sistemske strategije, uporabnikove in deljene strategije drugih: `{ id, name, description, author, visibility, system, mine }`; `author` je »Sistem« pri sistemskih; kode ne vrne |
| `GET /api/strategies/:id` | isti podatki ter `source`, `default_params` in `created_at`; tuja zasebna ali neobstoječa strategija vrne `404` |

Obe poti zahtevata prijavo. Zasebnih strategij drugih uporabnikov ne vidi nihče, tudi administrator ne (P1).

Frontend: stran **Strategije** (trgovec) prikaže tabelo z imenom, opisom, avtorjem in oznako Zasebna/Deljena.

## Testi (backtests)

Tabeli `backtests` in `backtest_instruments` (migracija `007_backtests.sql`) hranita teste: lastnika, strategijo, borzo, obdobje (`period_from`, `period_to`, oba dneva vključno, UTC), uporabljene parametre, rezultate, stanje (`draft` ob nastanku) in vidnost (`private`). Test se shrani šele po uspešnem izračunu.

| Pot | Opis |
|---|---|
| `POST /api/backtests` | izračuna test in ga shrani kot `draft`; `201` s polnim testom |
| `GET /api/backtests` | testi prijavljenega trgovca, najnovejši prvi, s povzetkom rezultatov (`summary`) |
| `GET /api/backtests/:id` | poln test z `results` (metrike, stroški, dnevna krivulja, brez poslov); tuj ali neobstoječ test vrne `404` |
| `GET /api/backtests/:id/trades?page=N` | posli testa po času vstopa, po 20 na stran (`page` privzeto 1); odgovor `{ page, pageSize, total, pages, trades }`, neveljaven `page` vrne `400`, tuj ali neobstoječ test `404` |

Poti so samo za vlogo trgovec (`401` brez prijave, `403` za mentorja in administratorja).

Telo zahtevka `POST /api/backtests` (JSON):

| Polje | Pravilo |
|---|---|
| `strategy_id` | obvezno; strategija, ki jo uporabnik sme videti (sistemska, lastna ali deljena) |
| `instruments` | obvezno; vsaj eno, neponovljeno sredstvo (`ticker`) |
| `venue_id` | obvezno; borza |
| `from`, `to` | obvezna, `YYYY-MM-DD`; `from` mora biti pred `to`, obdobje pa v razponu podatkov vseh izbranih sredstev (po dnevih, UTC) |
| `params` | neobvezno; objekt, ki se združi s `default_params` strategije samo za ta test (strategija ostane nespremenjena) |

Odgovori ob napaki: `400` z `{ "errors": { "<polje>": "<sporočilo>" } }` pri neveljavnem vhodu (polja `strategy_id`, `instruments`, `venue_id`, `from`, `to`, `params` in `period`; pri obdobju zunaj podatkov sporočilo vsebuje veljaven razpon) in `422` z `{ "error": "<razlog>" }`, če strategija vrže napako, preseže čas ali vrne neveljavne posle. V obeh primerih se test ne shrani, sporočilo pa ne vsebuje notranjih podrobnosti strežnika.

Izračun: strategija teče v delavcu za vsako izbrano sredstvo (skupna omejitev 60 s), nato `simulate` (poglavje »Simulacija«) izračuna rezultat z borzo in razponi iz baze. Začetni kapital testa je 10.000 in se enakomerno razdeli med izbrana sredstva. V `results` so metrike (`netProfit`, `returnPct`, `tradeCount`, `winRatePct`, `maxDrawdownPct`), bruto dobiček in stroški (`grossProfit`, `costs`), dnevna krivulja (`equityCurve`) in posli (`trades`). Posli so shranjeni v `results`, vendar jih `GET /api/backtests/:id` ne vrne; berejo se po straneh preko `/trades`.

Omejitev obsega: backend pred nalaganjem prešteje svečke v izbranem obdobju in zavrne test, če jih je za katerokoli sredstvo več kot `MAX_BARS` (400.000, pri minutnih podatkih okoli 9 mesecev). Odgovor je `400` z `errors.period` (»Obdobje za <TICKER> vsebuje N svečk, dovoljenih je največ 400.000. Izberite krajše obdobje.«). Brez omejitve bi backend pri milijonih svečk zmanjkalo pomnilnika.

### Stran Backtests (frontend)

Stran **Backtests** (trgovec, wireframe WF-02) ima levo obrazec »Nov test«, desno pa »Seznam zagonov«.

- **Obrazec:** strategija, eno ali več sredstev (sredstva brez zgodovinskih podatkov so onemogočena), obdobje Od/Do, borza (prikaže provizije in razpon), financiran račun in nastavitve strategije. Polje za financiran račun je zaenkrat onemogočeno, ker preverjanje pravil še ni uvedeno.
- **Obdobje:** poleg ročnega vnosa datumov so prednastavitve »Celotna zgodovina«, »Zadnje leto«, »Zadnja 3 leta« in »Zadnjih 5 let«. Računajo se iz skupnega razpona podatkov izbranih sredstev, začetek pa ni nikoli pred začetkom podatkov.
- **Nastavitve strategije:** za vsak privzeti parameter strategije je eno polje. Na backend se pošljejo samo spremenjene vrednosti, ki veljajo samo za ta test; `default_params` strategije ostanejo nespremenjeni.
- **Napake:** validacijo opravi backend, napake so prikazane ob poljih (npr. veljaven razpon podatkov ob obdobju zunaj podatkov), razlog napake ali prekinitve strategije pa pod gumbom »Zaženi test«, brez notranjih podrobnosti strežnika.
- **Po zagonu** se odpre stran rezultatov `#backtests/<id>`; njena polna vsebina (metrike, krivulja, stroški, posli) sledi v naslednji nalogi.
- **Seznam zagonov:** lastni testi (zagon, obdobje, rezultat, vidnost), najnovejši prvi; klik na vrstico odpre rezultate. Filter po skupini sredstev (`asset_class`: Crypto, Forex, Indeksi, Zlato) in »Vse«; zagon z več sredstvi se prikaže v skupini vsakega svojega sredstva.

## Testiranje

Testi se izvajajo v containerju backenda, ker ta doseže bazo:

```
docker compose run --rm --build backend npm test
```

Zastavica `--build` poskrbi, da se image pred zagonom osveži. Ukaz zažene bazo (če še ne teče), za vsak test ustvari začasno bazo (`test_...`), požene teste z vgrajenim `node --test` in bazo po testu izbriše. Tipe preveriš z `npm run typecheck` v mapi `backend`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) ob vsakem pushu in pull requestu zažene tipski preizkus, teste backenda in build frontenda. Da neuspeh prepreči merge, je v nastavitvah repozitorija (Settings, Branches) za `main` nastavljeno pravilo, ki zahteva uspešno preverjanje `ci`.

