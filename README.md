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
| `POST /api/strategies` | naloži lastno strategijo (trgovec); `201` s celotno strategijo |
| `PATCH /api/strategies/:id` | spremeni podana polja lastne strategije (trgovec) |
| `DELETE /api/strategies/:id` | izbriše lastno strategijo brez testov (trgovec) |

Branje zahteva prijavo. Zasebnih strategij drugih uporabnikov ne vidi nihče, tudi administrator ne (P1).

### Nalaganje lastnih strategij

Telo `POST` (JSON): `name`, `source` (besedilo datoteke), neobvezno `description` in `default_params`. Napake vrne `400` z `{ "errors": { "<polje>": "<sporočilo>" } }`, strategija se tedaj ne shrani.

| Polje | Pravilo |
|---|---|
| `name` | obvezno, 3–80 znakov (po odstranitvi presledkov) |
| `description` | neobvezno, največ 500 znakov |
| `source` | obvezno, največ 100 KB (v bajtih), besedilo z `export default` (oblika v poglavju »Simulacija«), ki ga je mogoče razčleniti; sporočilo vsebuje razlog in vrstico |
| `default_params` | neobvezno; JSON (besedilo ali objekt), ki je objekt z največ 20 parametri, vrednosti so število, besedilo ali `true`/`false` |

Datoteka se pri nalaganju samo prevede (preverjanje sintakse), nikoli ne zažene; izvaja se šele v delavcu (poglavje »Izolirano izvajanje strategij«). Nova strategija je vedno `private` z lastnikom prijavljenega trgovca; deljenje ni del te funkcionalnosti, zato `PATCH` vidnosti in lastnika ne spreminja.

`PATCH` spremeni samo podana polja z enakimi pravili. Urejanje in brisanje sme samo lastnik: tuja zasebna strategija vrne `404` (P1), vidna a tuja (sistemska ali deljena) pa `403`. Strategije, ki jo uporabljajo izvedeni testi, `DELETE` ne izbriše in vrne `409` z `{ "error": "...", "tests": N }`, kjer je `N` število testov. Urejanje takšne strategije je dovoljeno, shranjeni rezultati starih testov se ne spremenijo. Mentor in administrator dobita `403`.

Frontend: stran **Strategije** (trgovec) prikaže tabelo z imenom, opisom, avtorjem in oznako Zasebna/Deljena. Gumb »Nova strategija« (`#strategije/nova`) odpre obrazec z imenom, opisom, datoteko `.js` in privzetimi parametri; končnico in velikost datoteke preveri že brskalnik, ostalo backend, napake pa so ob poljih. Pri lastnih strategijah sta dejanji »Uredi« (`#strategije/<id>`, datoteka je neobvezna) in »Izbriši« (s potrditvijo; če strategijo uporabljajo testi, je prikazano njihovo število). Povezava »Naloži lastno strategijo« je tudi v obrazcu Nov test; naložena strategija je ob vrnitvi na Backtests v izbirniku.

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
| `prop_plan_id` | neobvezno; načrt financiranega računa (`prop_plans`); prazna vrednost pomeni brez načrta (poglavje »Pravila financiranega računa«) |

Odgovori ob napaki: `400` z `{ "errors": { "<polje>": "<sporočilo>" } }` pri neveljavnem vhodu (polja `strategy_id`, `instruments`, `venue_id`, `from`, `to`, `params`, `prop_plan_id` in `period`; pri obdobju zunaj podatkov sporočilo vsebuje veljaven razpon) in `422` z `{ "error": "<razlog>" }`, če strategija vrže napako, preseže čas ali vrne neveljavne posle. V obeh primerih se test ne shrani, sporočilo pa ne vsebuje notranjih podrobnosti strežnika.

Izračun: strategija teče v delavcu za vsako izbrano sredstvo (skupna omejitev 60 s), nato `simulate` (poglavje »Simulacija«) izračuna rezultat z borzo in razponi iz baze. Začetni kapital testa je 10.000 in se enakomerno razdeli med izbrana sredstva. V `results` so metrike (`netProfit`, `returnPct`, `tradeCount`, `winRatePct`, `maxDrawdownPct`), bruto dobiček in stroški (`grossProfit`, `costs`), dnevna krivulja (`equityCurve`) in posli (`trades`). Posli so shranjeni v `results`, vendar jih `GET /api/backtests/:id` ne vrne; berejo se po straneh preko `/trades`.

Omejitev obsega: backend pred nalaganjem prešteje svečke v izbranem obdobju in zavrne test, če jih je za katerokoli sredstvo več kot `MAX_BARS` (400.000, pri minutnih podatkih okoli 9 mesecev). Odgovor je `400` z `errors.period` (»Obdobje za <TICKER> vsebuje N svečk, dovoljenih je največ 400.000. Izberite krajše obdobje.«). Brez omejitve bi backend pri milijonih svečk zmanjkalo pomnilnika.

### Pravila financiranega računa

Če test izbere načrt (`prop_plan_id`), se izvede s kapitalom računa (`account_size`) namesto z začetnim kapitalom 10.000, nato pa `checkChallenge` (`propRules.ts`) iz dnevne krivulje (poglavje »Dnevna krivulja«) preveri tri pravila. Test se vedno izvede do konca obdobja, kršitev ga ne ustavi.

| Pravilo | Dosežen znesek | Izpolnjeno, če |
|---|---|---|
| Cilj dobička (`profit_target`) | neto dobiček ob koncu obdobja | dobiček je najmanj `profit_target` |
| Največja dnevna izguba (`max_daily_loss`) | največji dnevni padec vrednosti | nobeden dan ne izgubi več kot `max_daily_loss` |
| Največja skupna izguba (`max_total_loss`) | največji padec pod začetno stanje računa | vrednost nikoli ne pade za več kot `max_total_loss` pod `account_size` |

- **Dnevna izguba** je razlika med vrednostjo ob koncu prejšnjega dneva in vrednostjo ob koncu tega dneva (prvi dan se meri od začetnega stanja računa). **Skupna izguba** se meri glede na začetno stanje računa.
- Izguba, ki je enaka dovoljeni, še ni kršitev; kršitev je izguba, večja od dovoljene. Zneski se primerjajo zaokroženi na cente.
- Pri kršitvi dnevne ali skupne izgube je zabeležen datum prve kršitve (`firstViolation`, `YYYY-MM-DD`).
- Krivulja je dnevna in vsebuje samo realizirane rezultate, zato znotrajdnevnih padcev ne zazna.

Rezultati so v `results.challenge`: `{ passed, profitTarget, maxDailyLoss, maxTotalLoss }`, kjer ima vsako pravilo `{ achieved, allowed, passed, firstViolation }`. Skupni izid se shrani tudi v stolpec `challenge_passed` (`true` samo, če so izpolnjena vsa tri pravila), načrt pa v `prop_plan_id`. **Brez načrta** sta oba stolpca prazna (`NULL`) in razdelka `results.challenge` ni; baza to zagotavlja z omejitvijo `CHECK` (`challenge_passed` je prazen natanko takrat, ko je prazen `prop_plan_id`). Odgovora `GET /api/backtests` in `GET /api/backtests/:id` vsebujeta `challenge_passed` in `prop_plan` (ime in pravila načrta ali `null`).

### Stran Backtests (frontend)

Stran **Backtests** (trgovec, wireframe WF-02) ima levo obrazec »Nov test«, desno pa »Seznam zagonov«.

- **Obrazec:** strategija, eno ali več sredstev (sredstva brez zgodovinskih podatkov so onemogočena), obdobje Od/Do, borza (prikaže provizije in razpon), financiran račun in nastavitve strategije. Financiran račun je neobvezen; ob izbiri se prikažejo njegova pravila, test pa teče s kapitalom računa (poglavje »Pravila financiranega računa«).
- **Obdobje:** poleg ročnega vnosa datumov so prednastavitve »Celotna zgodovina«, »Zadnje leto«, »Zadnja 3 leta« in »Zadnjih 5 let«. Računajo se iz skupnega razpona podatkov izbranih sredstev, začetek pa ni nikoli pred začetkom podatkov.
- **Nastavitve strategije:** za vsak privzeti parameter strategije je eno polje. Na backend se pošljejo samo spremenjene vrednosti, ki veljajo samo za ta test; `default_params` strategije ostanejo nespremenjeni.
- **Napake:** validacijo opravi backend, napake so prikazane ob poljih (npr. veljaven razpon podatkov ob obdobju zunaj podatkov), razlog napake ali prekinitve strategije pa pod gumbom »Zaženi test«, brez notranjih podrobnosti strežnika.
- **Po zagonu** se odpre stran rezultatov `#backtests/<id>` (poglavje »Stran rezultatov«).
- **Seznam zagonov:** lastni testi (zagon, obdobje, rezultat, vidnost; pri testu z načrtom tudi izid izziva), najnovejši prvi; klik na vrstico odpre rezultate. Filter po skupini sredstev (`asset_class`: Crypto, Forex, Indeksi, Zlato) in »Vse«; zagon z več sredstvi se prikaže v skupini vsakega svojega sredstva.

### Stran rezultatov (frontend)

Stran `#backtests/<id>` (trgovec, wireframe WF-03) prikazuje:

- **Glavo** z naslovom zagona in stanjem testa (`draft` se prikaže kot »Osnutek«).
- **Šest metrik:** neto dobiček, donosnost, število poslov, največji padec, delež dobičkonosnih poslov in skupne stroške.
- **Nastavitve testa:** strategijo, parametre, sredstva, borzo, obdobje, začetni kapital in financiran račun (»ni izbran«, če načrt ni bil izbran).
- **Krivuljo vrednosti računa** za celotno obdobje (SVG iz dnevne krivulje; črtkana črta je začetni kapital). Prva kršitev dnevne in skupne izgube je označena z rdečo navpično črto in datumom.
- **Stroške borze** (bruto dobiček, provizije, razpon, neto dobiček) in, samo če je bil izbran načrt, blok **Pravila financiranega računa**: za vsako pravilo (cilj dobička, največja dnevna izguba, največja skupna izguba) doseženi in dovoljeni znesek, oznaka Izpolnjeno/Kršeno, datum prve kršitve in skupni izid izziva. Brez načrta bloka ni.
- **Tabelo poslov** (datum, sredstvo, rezultat) po času vstopa s paginacijo po 20; strani prihajajo iz `GET /api/backtests/:id/trades`.

Besedilo iz podatkov (ime strategije, parametri) se vstavlja kot besedilo, ne kot HTML. Neobstoječ ali tuj test prikaže sporočilo »Test ne obstaja«.

## Povezava mentor–trgovec

Tabela `mentor_links` (migracija `009_mentor_links.sql`, docs/03) hrani povezavo med mentorjem in učencem (trgovcem), ki jo ustvari vabilo. Stanja: `invited` (vabilo), `active`, `declined` in `ended`.

| Pot | Vloga | Opis |
|---|---|---|
| `GET /api/mentor-links` | mentor, trgovec | povezave prijavljenega uporabnika, najnovejše prve: `{ id, status, created_at, updated_at, mentor: { id, name }, trader: { id, name, email } }` |
| `POST /api/mentor-links` | mentor | vabilo trgovca: `{ "email": "..." }`; `201` z novo povezavo |
| `POST /api/mentor-links/:id/accept` | trgovec | sprejme vabilo (`invited` → `active`) |
| `POST /api/mentor-links/:id/decline` | trgovec | zavrne vabilo (`invited` → `declined`) |
| `POST /api/mentor-links/:id/end` | mentor ali trgovec | prekine aktivno povezavo (`active` → `ended`) |

Pravila:

- **Vabilo:** e-naslov se normalizira (trim, male črke). Če trgovec ne obstaja, ima drugo vlogo ali je blokiran, vabilo ni ustvarjeno in odgovor je `400` z `{ "errors": { "email": "Registriran trgovec s tem e-naslovom ne obstaja" } }`. Sporočilo je enako v vseh teh primerih, da vabilo ne razkrije, kakšen račun ima e-naslov.
- **Enoličen par:** par (`mentor_id`, `trader_id`) je enoličen, zato je vsako naslednje vabilo istemu trgovcu zavrnjeno (`409`, sporočilo glede na stanje: čaka na odgovor, že učenec, zavrnjeno, prekinjeno). Po zavrnitvi ali prekinitvi ponovno vabilo istega mentorja torej ni mogoče; drug mentor lahko trgovca povabi.
- **En aktiven mentor:** trgovec z aktivnim mentorjem ne more sprejeti drugega vabila (`409`, »Že imate aktivnega mentorja«); vabilo ostane v stanju `invited`. Pravilo zagotavlja delni enolični indeks `mentor_links_one_active_mentor_idx` (`trader_id` pri `status = 'active'`), zato velja tudi pri sočasnih zahtevkih. Po prekinitvi aktivne povezave je sprejem drugega vabila spet mogoč.
- **Prekinitev:** aktivno povezavo prekine mentor ali trgovec. Mentor teste učenca vidi samo, dokler je povezava `active`; ta pogoj uporabijo naslednje naloge (oddaja in pregled testov).
- **Dostop:** uporabnik vidi samo svoje povezave; tuja povezava je kot neobstoječa (`404`, P1). Dejanje v nedovoljenem stanju vrne `409`. Administrator in neprijavljeni nimata dostopa (`403`, `401`). Trgovec v odgovoru ne dobi mentorjevega e-naslova.

Frontend:

- **Mentorjev dashboard** (`#dashboard`, wireframe WF-04): panel »Učenci« (ime, e-naslov, stanje povezave, število vseh testov in stolpec »Čaka« za aktivne učence; gumb »Odstrani« z dvostopenjsko potrditvijo) in »Povabi učenca« (e-naslov, »Pošlji vabilo«; razlog zavrnitve je ob polju). Panel »Zagoni za pregled« ima zavihke Oddani, V pregledu, Spremembe in Odobreni, tabelo (Zagon, Učenec, Oddano, Stanje, akcija) in paginacijo po 20. Pri oddanih testih je akcija »Začni pregled«, ki odpre stran pregleda, pri ostalih »Odpri«. Panel »Skupna analitika učencev« je zaenkrat prostor za naslednjo nalogo.
- **Stran Mentor trgovca** (`#mentor`): trenutni mentor z gumbom »Prekini povezavo« (s potrditvijo) in čakajoča vabila z imenom mentorja ter gumboma »Sprejmi« in »Zavrni«. Če trgovec že ima aktivnega mentorja, je ob sprejemu drugega vabila prikazano »Že imate aktivnega mentorja«.
- Po vsakem dejanju se stran osveži; če se je stanje povezave medtem spremenilo (`404`, `409`), je prikazan razlog, vsebina pa se po kratkem času osveži.
- **Mentorjev pogled testa** (`#pregled/<id>`): ista stran rezultatov kot pri trgovcu, samo za branje. Razdelek »Mentorski pregled« kaže učenca in zgodovino stanj, pri oddanem testu gumb »Začni pregled«. Stran ni v navigaciji; test, ki ga mentor ne vidi (osnutek, tuj učenec, prekinjena povezava), prikaže »Test ne obstaja«.
- **Zaslon mentorjevega pregleda** (`#pregled/<id>`, wireframe WF-05): oznaka »Samo za branje«, štiri metrike (neto dobiček, donosnost, največji padec, delež dobičkonosnih), krivulja, blok »Nastavitve (zaklenjeno)« s parametri in stroški ter posli. Desno so »Komentarji«, »Odločitev in zgodovina stanj«. Zabeležene napake so izpisane ločeno nad običajnimi komentarji, z rdečo oznako »Napaka«. Obrazec za komentar (z »Označi kot napako«) je viden samo med pregledom; »Zahtevaj spremembe« je onemogočen, dokler ni vsaj enega komentarja, »Zahtevaj spremembe« in »Odobri« zahtevata potrditev. Po odločitvi so komentarji zaklenjeni.
- **Trgovec** na strani rezultatov (`#backtests/<id>`) za oddan test vidi panel »Mentorjev odziv«: trenutno stanje in mentorjeve komentarje samo za branje (napake ločeno, z rdečo oznako). Pri stanju »Zahtevane spremembe« je na voljo gumb »Ponovi test«, ki ustvari nov osnutek z istimi nastavitvami in ga odpre; če ponovitev že obstaja, panel kaže povezavo nanjo. Ponovitev ima v glavi povezavo »Ponovitev testa #N« na prejšnji test, seznam zagonov pa pri njej pripiše »ponovitev #N«.

## Oddaja testa v mentorski pregled

Trgovec test, ki je v stanju `draft`, odda svojemu aktivnemu mentorju (US-12). Stanja testa: `draft`, `submitted`, `in_review`, `changes_requested`, `approved`, `withdrawn`. Dovoljene prehode določa čista funkcija `transition()` v `backend/src/testStatus.ts`; trenutno se uporabljata `submit` (`draft` → `submitted`) in `withdraw` (`submitted` → `withdrawn`), ostale prehode (pregled) doda naloga za mentorski pregled. Migracija `010_status_history.sql` doda `backtests.reviewer_id` in tabelo `status_history`.

| Pot | Vloga | Opis |
|---|---|---|
| `POST /api/backtests/:id/submit` | trgovec | odda osnutek aktivnemu mentorju; `reviewer_id` postane mentor |
| `POST /api/backtests/:id/withdraw` | trgovec | umakne oddajo, dokler je test `submitted` |

Odgovor obeh poti je test kot pri `GET /api/backtests/:id`, ki zdaj vsebuje še `reviewer` (`{ id, name }` ali `null`) in `history` (seznam `{ from_status, to_status, changed_at, changed_by: { id, name } }` od najstarejšega prehoda). Seznam `GET /api/backtests` vsebuje `status` in `reviewer`.

Pravila:

- **Mentor:** oddaja brez aktivne povezave je zavrnjena (`409`), test ostane osnutek.
- **Umik:** mogoč samo v stanju `submitted`; ko mentor pregled začne (`in_review`), umik vrne `409`. Umaknjenega testa ni mogoče znova oddati (zgodbe ponovne oddaje ne določajo); za popravke trgovec izvede nov test.
- **Zgodovina:** vsak prehod se zapiše v `status_history` (od, v, uporabnik, čas) v isti transakciji kot sprememba stanja. Vrstica testa se pred spremembo zaklene (`FOR UPDATE`), zato sočasna zahtevka ne podvojita prehoda.
- **Dostop:** tuj ali neobstoječ test je `404`, mentor `403`, neprijavljen `401`, napačno stanje `409`.

Frontend (stran rezultatov `#backtests/<id>`, razdelek »Mentorski pregled«):

- **Osnutek:** gumb »Oddaj mentorju« je aktiven samo, če ima trgovec aktivno povezavo z mentorjem (preverjeno prek `GET /api/mentor-links`). Sicer je onemogočen, ob njem pa piše »Najprej se poveži z mentorjem« s povezavo na stran Mentor.
- **Oddan:** gumb »Umakni oddajo« z dvostopenjsko potrditvijo. V stanju »V pregledu« gumba ni, prikazano je pojasnilo.
- Prikazana sta mentor in zgodovina stanj (čas, prehod, uporabnik). Značka stanja je v glavi strani, stanje pa tudi v stolpcu »Stanje« v seznamu zagonov (`frontend/src/status.ts` hrani skupne nazive stanj).
- Če se stanje medtem spremeni (`404`, `409`), je prikazan razlog, stran pa se po kratkem času osveži.

### Mentorjev dostop do testov (samo branje)

`GET /api/backtests/:id` in `GET /api/backtests/:id/trades` (US-13) lahko pokliče tudi mentor, vendar samo za teste, ki jih izpolnjeni vsi trije pogoji hkrati: test je bil oddan temu mentorju (`reviewer_id`), je v stanju `submitted`, `in_review`, `changes_requested` ali `approved` in je povezava z lastnikom testa `active`. Pogoj je v `visibleTo()` (`backend/src/backtestsApi.ts`) in velja za vse poti, ki berejo test.

- Osnutki, umaknjeni testi, testi drugih trgovcev, testi, oddani drugemu mentorju, in testi učenca po prekinitvi povezave so za mentorja neobstoječi (`404`, P1).
- Odgovor vsebuje še `owner` (`{ id, name }`, trgovec, ki je test naredil).
- `PUT` in `PATCH` na `/api/backtests/:id` vrneta `403` (»Parametrov in rezultatov testa ni mogoče spreminjati«) za vsak viden test, tudi za lastnika, ker je izveden test nespremenljiv; za nevidni test `404`. Oddaja, umik in ustvarjanje testov ostanejo samo za trgovca (`403` za mentorja).

### Mentorjev dashboard in začetek pregleda (API)

| Pot | Vloga | Opis |
|---|---|---|
| `GET /api/mentor/students` | mentor | aktivni učenci: `{ id, name, email, test_count, waiting_count }`, po imenu |
| `GET /api/mentor/backtests?status=&page=` | mentor | testi za pregled v stanju `status` (privzeto `submitted`; `submitted`, `in_review`, `changes_requested`, `approved`), po 20 na stran: `{ status, page, pageSize, total, pages, items: [{ id, strategy_name, status, owner, instruments, from, to, submitted_at }] }` |
| `POST /api/backtests/:id/start-review` | mentor | `submitted` → `in_review`, prehod se zapiše v `status_history` |

- `test_count` so vsi testi učenca, ki jih mentor vidi (oddani in naprej; osnutki in umaknjeni testi se ne štejejo), `waiting_count` pa tisti v stanju `submitted`. Povabljeni, zavrnjeni in prekinjeni učenci na seznamu niso.
- Čakajoči testi so urejeni od najstarejše oddaje (vrstni red pregleda), ostali od najnovejšega. `submitted_at` je čas zadnje oddaje iz `status_history`. Neveljavno stanje ali stran vrne `400`, stran za zadnjo je veljavna in vrne prazen seznam.
- Začetek pregleda uporablja pravilo `visibleTo()`: test, ki ga mentor ne vidi, je `404`, test v drugem stanju kot `submitted` je `409`. Vrstica se pred spremembo zaklene, zato sočasna zahtevka ne podvojita prehoda.

### Komentarji in odločitev o testu (API)

Tabela `comments` (migracija `011_comments.sql`, docs/03) hrani mentorjeve komentarje: `body` (1–2000 znakov), `is_mistake`, avtorja in čas.

| Pot | Vloga | Opis |
|---|---|---|
| `GET /api/backtests/:id/comments` | trgovec (lastnik), mentor | komentarji testa od najstarejšega: `{ id, body, is_mistake, created_at, author: { id, name } }` |
| `POST /api/backtests/:id/comments` | mentor | doda komentar `{ "body": "...", "is_mistake": false }`; `201` |
| `POST /api/backtests/:id/request-changes` | mentor | `in_review` → `changes_requested`, samo če ima test vsaj en komentar |
| `POST /api/backtests/:id/approve` | mentor | `in_review` → `approved` |

- **Komentar:** besedilo se obreže, prazno ali daljše od 2000 znakov (štejejo znaki, ne bajti) je `400` z `{ "errors": { "body": "..." } }`; `is_mistake` mora biti `true` ali `false`. Dodati ga je mogoče samo med pregledom (`in_review`, sicer `409`) in samo k testu, ki ga mentor vidi (sicer `404`). Vrstica testa se pred vpisom zaklene, zato po odobritvi ali zahtevi za spremembe komentar ne more nastati niti pri sočasnih zahtevkih.
- **Odločitev:** vsak prehod se zapiše v `status_history` (mentor, čas). Zahteva za spremembe brez komentarja je `409`; odobritev komentarja ne zahteva. Po odločitvi (`changes_requested`, `approved`) so komentarji zaklenjeni, stanji sta končni.
- **Trgovec:** komentarje svojega testa lahko bere, dodajati, spreminjati ali brisati jih ne more (`403` pri dodajanju; poti za spreminjanje in brisanje ne obstajajo, `405`/`404`).
- Testi v `testDb.ts` ustvarijo bazo s kodiranjem UTF-8 ne glede na privzeto kodiranje strežnika, da dolžina komentarja šteje znake.

### Ponovitev testa (»Ponovi test«)

Ko mentor zahteva spremembe (`changes_requested`), trgovec iz testa naredi ponovitev. Migracija `012_backtest_previous.sql` doda `backtests.previous_id` in enolični delni indeks, ki dovoli največ eno ponovitev iz istega testa.

| Pot | Vloga | Opis |
|---|---|---|
| `POST /api/backtests/:id/retest` | trgovec (lastnik) | ustvari nov test z istimi nastavitvami; `201` z novim testom |

- **Nastavitve:** strategija, parametri, sredstva, borza, obdobje in načrt financiranega računa se prenesejo. Test se izračuna znova s trenutno strategijo in podatki (strategijo je medtem mogoče popraviti), zato se rezultat lahko razlikuje. Nov test je v stanju `draft`, brez mentorja in zgodovine ter kaže na prejšnjega (`previous_id`). Če izračun ne uspe (npr. manjkajo podatki), test ni ustvarjen in je odgovor enak kot pri navadnem zagonu (`400`/`422`).
- **Pogoji:** prvotni test mora biti v stanju `changes_requested` (sicer `409`) in ne sme biti že ponovljen (`409`, tudi pri sočasnih zahtevkih). Tuj ali neobstoječ test je `404`, mentor in administrator `403`.
- **Odgovor:** vsak test vsebuje `previous_id` (test, iz katerega je nastal, ali `null`) in `next_id` (njegova ponovitev ali `null`); to velja tudi za seznam `GET /api/backtests`. Prvotni test ostane nespremenjen v stanju `changes_requested`; ponovitev se odda mentorju kot vsak osnutek.

### Katalog strategij in deljenje strategij (API)

| Pot | Vloga | Opis |
|---|---|---|
| `GET /api/strategy-catalog?source=&q=&page=` | trgovec | vidne strategije po izvoru, z iskanjem in paginacijo: `{ source, q, page, pageSize, total, pages, items: [{ id, name, description, visibility, system, mine, author }] }` |
| `PUT /api/strategies/:id/visibility` | trgovec (lastnik) | `{ "visibility": "private" \| "shared" }`; vrne strategijo |

- **Katalog** (US-03) vrne sistemske strategije (`author` je »Sistem«), lastne in tuje strategije z vidnostjo `shared`; tuje zasebne strategije so nevidne (P1). Izvor: `all` (privzeto), `mine`, `system`, `shared` (strategije uporabnikov z vidnostjo `shared`, sistemske ne). Po imenu se išče od 3 znakov (krajše besedilo se prezre; velikost črk ni pomembna, `%` in `_` sta navadna znaka). Strani imajo po 20 strategij, stran za zadnjo je veljavna in vrne prazen seznam. Katalog ne vrača izvorne kode. Stari `GET /api/strategies` ostane polni seznam za izbiro strategije pri novem testu.
- **Deljenje** (US-10): vidnost preklopi samo lastnik (tuja zasebna strategija je `404`, vidna a tuja ali sistemska `403`, neveljavna vrednost `400`). Deljena strategija je takoj vidna drugim trgovcem, ki jo lahko izberejo za svoj test, ne morejo pa je urejati ali brisati (`403`). Ob vrnitvi na `private` takoj izgine iz njihovih seznamov, že izvedeni testi drugih (`strategy_id` ostane) pa ostanejo njihovi. Nova strategija je vedno `private`.

### Deljenje testov (API)

| Pot | Vloga | Opis |
|---|---|---|
| `PUT /api/backtests/:id/visibility` | trgovec (lastnik) | `{ "visibility": "private" \| "shared" }`; vrne test |
| `GET /api/backtests?scope=shared` | trgovec | testi drugih trgovcev z vidnostjo `shared`, najnovejši prvi (privzeti `scope=mine` so lastni testi) |

- **Dostop:** deljeni test sme vsak trgovec brati (`GET /api/backtests/:id`, `/trades`), a samo za branje: `PUT`/`PATCH` na test vrneta `403`, oddaja, umik, ponovitev, komentarji in preklop vidnosti ostanejo lastniku (`404`, pri preklopu vidnosti `403`). Pri tujem testu so mentor, zgodovina stanj in povezave med testi (`previous_id`, `next_id`) skriti. Ob vrnitvi na `private` test takoj izgine iz seznamov in dostopa drugih (`404`). Nov test je vedno `private`.
- **Mentorji** deljenih testov ne vidijo prek seznama; mentor test še vedno vidi samo po pravilih pregleda (oddan njemu, aktiven učenec). Deljenje testa mentorju ne odpre testov tujih učencev. Administrator nima dostopa.

### Pregled in deljenje (frontend)

- **Strategije:** seznam uporablja katalog (`/api/strategy-catalog`): filtri Vse / Moje / Sistemske / Deljene, iskanje po imenu od 3 znakov, paginacija po 20, prazno stanje »Ni strategij« s povezavo na nalaganje nove strategije. Lastne vrstice imajo gumb **Deli** / **Prekliči deljenje** z dvostopenjsko potrditvijo; tuje deljene strategije so brez Uredi/Izbriši.
- **Rezultat testa:** lastnik vidi značko vidnosti in gumb Deli; tuj deljen test se odpre samo za branje (opomba »Deljeni test uporabnika …«, brez mentorskega pregleda in odziva).
- **Zagoni:** zavihka »Moji zagoni« in »Deljeni zagoni« (tuji zagoni z avtorjem); stolpec Vidnost pri lastnih. Ob vrnitvi na zasebno deljeni zagon takoj izgine iz tujih seznamov.

### Primerjava testov (API)

- `GET /api/backtests/compare?ids=3,7,9` (samo trgovec): primerjava 2–4 testov v vrstnem redu iz `ids`. Za vsak test vrne strategijo, parametre, sredstva, borzo, obdobje, načrt financiranega računa z izidom (`challenge_passed`), avtorja in `results` z `netProfit`, `returnPct`, `tradeCount`, `winRatePct`, `maxDrawdownPct`, `initialCapital` ter `equityCurve` (brez poslov).
- `400`, če ni od 2 do 4 id-jev, so podvojeni ali neveljavni; `404` za celoto, če je kateri test neobstoječ ali ga trgovec ne sme brati (P1: odgovor ne razkrije, kateri tuji testi obstajajo). Primerljivi so lastni testi in testi, ki jih je drug trgovec delil; pri tujih ni mentorja.

### Primerjava testov (frontend)

- Na seznamu zagonov ima vsaka vrstica potrditveno polje (v »Moji« in »Deljeni zagoni«; izbira ostane ob menjavi zavihka ali filtra). Gumb **Primerjaj** je aktiven pri 2–4 izbranih testih, sicer je onemogočen s pojasnilom.
- Stran `#backtests/primerjava/<id,id,...>`: tabela (strategija, parametri, sredstva, borza, obdobje, avtor, neto dobiček, donosnost, število poslov, delež zmag, največji padec, preverjanje računa) z oznako ★ pri najboljši vrednosti (največ pri dobičku, donosnosti, številu poslov in deležu zmag; najmanj pri padcu; pri enakih vrednostih brez oznake) in skupen graf krivulj z legendo.
- Graf prikazuje donosnost v % glede na začetni kapital posameznega testa na skupni časovni osi, ker imajo testi lahko različen kapital in obdobje. Barve se razlikujejo tudi po vzorcu črte.

### Analitika učencev (API)

- `GET /api/mentor/students/analytics?period=all|30|90` (samo mentor, privzeto `all`; drugo je `400`): aktivni učenci mentorja z `tests`, `approved`, `approvedPct`, `mistakes` (komentarji z `is_mistake`) in `avgMaxDrawdownPct`, poleg tega `total` (vsote) in `average`.
- Šteje samo testi, ki jih mentor sme videti (oddani in naprej, njegov pregled, aktivna povezava), torej brez osnutkov in umaknjenih. Obdobje se presoja po času zadnje oddaje testa.
- `average`: testi in napake na učenca, delež odobrenih in največji padec pa so združeni čez vse teste (ne povprečje povprečij). Učenec brez testov ima `approvedPct` in `avgMaxDrawdownPct` enaka `null`; brez učencev je `average` enak `null`.

## Testiranje

Testi se izvajajo v containerju backenda, ker ta doseže bazo:

```
docker compose run --rm --build backend npm test
```

Zastavica `--build` poskrbi, da se image pred zagonom osveži. Ukaz zažene bazo (če še ne teče), za vsak test ustvari začasno bazo (`test_...`), požene teste z vgrajenim `node --test` in bazo po testu izbriše. Tipe preveriš z `npm run typecheck` v mapi `backend`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) ob vsakem pushu in pull requestu zažene tipski preizkus, teste backenda in build frontenda. Da neuspeh prepreči merge, je v nastavitvah repozitorija (Settings, Branches) za `main` nastavljeno pravilo, ki zahteva uspešno preverjanje `ci`.

