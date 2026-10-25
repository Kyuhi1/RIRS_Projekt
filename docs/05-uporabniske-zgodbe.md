# 1. Seznam uporabniških zgodb oz. funkcionalnosti
Projekt ima 17 unikatnih funkcionalnosti, katere opisujejo uporabniške zgodbe zapisane po formatu `[uporabniška vloga] želim [dejanje/cilj], da [razlog/vrednost].`

| Zgodba | Funk. | Naslov | Vloga | MVP zahteva |
|---|---|---|---|---|
| US-01 | F1 | Registracija | vsi (nov uporabnik) | MVP |
| US-02 | F1 | Prijava, odjava in prepoznava vloge | vsi | MVP |
| US-03 | F2 | Pregled obstoječih in deljenih strategij | Trgovec | / |
| US-04 | F3 | Nalaganje in nastavitev lastne strategije | Trgovec | MVP |
| US-05 | F4 | Izbira sredstev, borze in obdobja ter zagon testa | Trgovec | MVP |
| US-06 | F5 | Prikaz rezultatov testa | Trgovec | / |
| US-07 | F6 | Upoštevanje stroškov izbrane borze | Trgovec | MVP |
| US-08 | F7 | Preverjanje pravil financiranega računa | Trgovec | MVP |
| US-09 | F8 | Primerjava testov | Trgovec | / |
| US-10 | F9 | Deljenje strategij in testov | Trgovec | / |
| US-11 | F10 | Povezava mentor–trgovec z vabilom | Mentor (in Trgovec) | / |
| US-12 | F11 | Oddaja testa mentorju v pregled | Trgovec | MVP |
| US-13 | F12 | Mentorjev dashboard in začetek pregleda | Mentor | MVP |
| US-14 | F12 | Komentarji, napake in odločitev o testu | Mentor | MVP |
| US-15 | F13 | Skupna analitika učencev | Mentor | / |
| US-16 | F14 | Vzdrževanje referenčnih podatkov | Administrator | / |
| US-17 | F14 | Upravljanje uporabniških računov | Administrator | / |

## Preverjanje po INVEST
Vsaka uporabniška zgodba izpolnjuje kriterije INVEST;
- Independent: Vsaka zgodba je ločena glede na funkcionalnost.
- Negotiable: Vsaka zgodba ima določen cilj, ki je preverljiv.
- Valuable: Vsaka zgodba ima razlog za obstoj.
- Estimable: Vsaka zgodba temelji na definiranih funkcionalnostih.
- Small: Vsaka zgodba je majhna in po potrebi razdeli večjo funkcionalnost na več manjših.
- Testable: Vsaka zgodba vsebuje kriterije, ki morajo biti izpolnjeni z testiranjem.

&nbsp;

# 2. Uporabniške zgodbe

### US-01: Registracija

| | |
|---|---|
| **Funkcionalnost** | F1 - Registracija, prijava in prepoznava vloge |
| **Vloga** | Nov uporabnik |
| **MVP** | Da |

Kot nov uporabnik želim ustvariti uporabniški račun z uporabo e-poštnega naslova in gesla, da si omogočim dostop do platforme Backtester.

**Acceptance criteria**
1. Obrazec zahteva ime in priimek, e-naslov, geslo in vlogo (Trgovec ali Mentor). 
2. Vloge Administrator ni mogoče izbrati.
3. Če je e-naslov neveljavne oblike ali je geslo krajše od 8 znakov, sistem prikaže napako ob ustreznem polju in računa ne ustvari.
4. Če račun z istim e-naslovom že obstaja, sistem prikaže sporočilo »Račun s tem e-naslovom že obstaja« in ne ustvari novega zapisa.
5. Ob uspešni registraciji sistem v tabelo `users` zapiše uporabnika z izbrano vlogo in `blocked = false`, geslo shrani samo kot bcrypt zgoščeno vrednost, uporabnika pa preusmeri na prijavo s potrditvenim sporočilom.

---

### US-02: Prijava, odjava in prepoznava vloge

| | |
|---|---|
| **Funkcionalnost** | F1 - Registracija, prijava in prepoznava vloge |
| **Vloga** | Trgovec, Mentor, Administrator |
| **MVP** | Da |

Kot že registriran uporabnik se želim prijaviti v platformo Backtester tako, da sistem prepozna mojo vlogo in mi odobri dostop do meni namenjene vsebine.

**Acceptance criteria**
1. Ob pravilnem e-naslovu in geslu backend izda podpisan JWT v piškotku `httpOnly` in uporabnika preusmeri na začetno stran njegove vloge: Trgovec na seznam strategij, Mentor na dashboard, Administrator na administracijo.
2. Ob napačnem e-naslovu ali geslu sistem prikaže isto sporočilo »Napačen e-naslov ali geslo« (ne razkrije, kateri podatek je napačen) in piškotka ne izda.
3. Če je račun blokiran (`blocked = true`) in je geslo pravilno, sistem prijave ne dovoli in prikaže »Račun je blokiran«.
4. Neprijavljen uporabnik, ki odpre zaščiteno stran, je preusmerjen na prijavo. Prijavljen uporabnik, ki pokliče endpoint druge vloge (npr. Trgovec pokliče `GET /api/admin/users`), prejme `403`.
5. Ob odjavi (`POST /api/auth/logout`) sistem izbriše piškotek in zaščitne strani niso več dostopne brez nove prijave.

---

### US-03: Pregled obstoječih in deljenih strategij

| | |
|---|---|
| **Funkcionalnost** | F2 - Pregled obstoječih in deljenih strategij |
| **Vloga** | Trgovec |
| **MVP** | Ne |

Kot trgovec želim pregledati že implementirane, moje ali z menoj deljene strategije, da lahko hitro izberem, testiram in primerjam strategije.

**Acceptance criteria**
1. Seznam prikaže sistemske strategije (brez lastnika), moje strategije in strategije drugih z `visibility = shared`. Zasebnih strategij drugih uporabnikov ne prikaže (P1).
2. Vsaka vrstica prikazuje ime, kratek opis, avtorja (»Sistem« pri sistemskih) in oznako Zasebna/Deljena.
3. Seznam je mogoče filtrirati po izvoru (Vse, Moje, Sistemske, Deljene) in iskati po imenu; iskanje vrne zadetke, ko uporabnik vnese vsaj 3 znake.
4. Seznam ima paginacijo po 20 strategij na stran (P3).
5. Če ni zadetkov, sistem prikaže »Ni strategij« s povezavo za nalaganje nove strategije (US-04).

---

### US-04: Nalaganje in nastavitev lastne strategije

| | |
|---|---|
| **Funkcionalnost** | F3 - Nalaganje in nastavitev lastne strategije |
| **Vloga** | Trgovec |
| **MVP** | Da |

Kot trgovec želim naložiti svojo strategijo in imeti možnost nastavljanja njenih parametrov, da lahko različne konfiguracije testiram nad zgodovinskimi podatki.

**Acceptance criteria**
1. Obrazec zahteva ime (3–80 znakov) in datoteko strategije (P7). Opis in privzete parametre (`default_params`, JSON) lahko uporabnik doda.
2. Če datoteka presega 100 KB, ni v podprtem formatu ali je ni mogoče razčleniti, sistem strategije ne shrani in prikaže konkreten razlog.
3. Če privzeti parametri niso veljaven JSON, sistem prikaže napako ob polju in strategije ne shrani.
4. Nova strategija ima `visibility = private` in `owner_id` prijavljenega trgovca.
5. Lastnik lahko strategijo ureja in briše. Strategije, ki ima izvedene teste, sistem ne izbriše in prikaže število testov, ki jo uporabljajo.

---

### US-05: Izbira sredstev, borze in obdobja ter zagon testa

| | |
|---|---|
| **Funkcionalnost** | F4 - Izbira sredstev, borze in obdobja ter zagon testa |
| **Vloga** | Trgovec |
| **MVP** | Da (domensko) |

Kot trgovec želim izbrati strategijo, sredstva, borzo in časovno obdobje pred zagonom testov, da vidim kako se strategija obnese v omejenih okoljih.

**Acceptance criteria**
1. Obrazec zahteva strategijo, vsaj eno sredstvo (`instruments`), borzo (`venues`) in obdobje. Obdobje je mogoče izbrati s prednastavitvami (celotna zgodovina, zadnje 1, 3, 5 let) ali ročno z datumoma od–do.
2. Če je datum »od« enak ali kasnejši od datuma »do« ali obdobje leži izven razpoložljivih zgodovinskih podatkov, sistem zagona ne dovoli in prikaže veljaven razpon podatkov.
3. Ob zagonu (`POST /api/backtests`) sistem shrani test s stanjem `draft`, izbranimi sredstvi (`backtest_instruments`) in uporabljenimi parametri (`params`), nato prikaže stran rezultatov (US-06).
4. Če test traja dlje od 60 s ali strategija sproži napako, sistem test prekine, ga ne shrani in uporabniku prikaže razlog brez internih podrobnosti strežnika (P6).
5. Uporabnik lahko pred zagonom spremeni parametre strategije; spremenjene vrednosti veljajo samo za ta test in ne prepišejo `default_params` strategije.

*Odvisnost: prikaz rezultatov US-06.*

---

### US-06: Prikaz rezultatov testa

| | |
|---|---|
| **Funkcionalnost** | F5 - Prikaz rezultatov testa |
| **Vloga** | Trgovec |
| **MVP** | Ne |

Kot trgovec želim pregledati rezultate izvedenih testov, da lahko ocenim ali je strategija profitabilna ali ne.

**Acceptance criteria**
1. Stran prikazuje neto dobiček, donosnost (%), število poslov, največji padec kapitala (%) in delež dobičkonosnih poslov, izračunane po definicijah v tem dokumentu.
2. Stran prikazuje krivuljo vrednosti računa (equity curve) za celotno obdobje testa.
3. Stran prikazuje uporabljene nastavitve: strategijo, parametre, sredstva, borzo, obdobje in izbrani financiran račun, če je bil izbran.
4. Seznam posameznih poslov je razvrščen po času vstopa in ima paginacijo po 20 poslov.
5. Rezultate testa vidi lastnik, mentor aktivnega učenca in, če je `visibility = shared`, drugi uporabniki samo za branje. Za druge uporabnike sistem vrne `404` (P1).

---

### US-07: Upoštevanje stroškov izbrane borze

| | |
|---|---|
| **Funkcionalnost** | F6 - Upoštevanje stroškov izbrane borze |
| **Vloga** | Trgovec |
| **MVP** | Da (domensko) |

Kot trgovec želim, da testi upoštevajo realne stroške borz in izbranih sredstev, da lahko vidim realne rezultate strategije.

**Acceptance criteria**
1. Pri vsakem poslu sistem odšteje provizijo po vrednostih `maker_pct` ali `taker_pct` izbrane borze glede na vrsto naročila.
2. Če je pri borzi `pay_spread = true`, sistem pri vsakem poslu upošteva tudi razpon; če je `false`, razpona ne upošteva.
3. Rezultati prikažejo ločeno bruto dobiček, skupne stroške borze in neto dobiček, pri čemer velja neto = bruto − stroški.
4. Pri borzi z `maker_pct = 0`, `taker_pct = 0` in `pay_spread = false` so stroški 0 in sta bruto in neto dobiček enaka.
5. Isti test, zagnan z dvema različnima borzama, ima enak bruto dobiček in različne stroške.

---

### US-08: Preverjanje pravil financiranega računa

| | |
|---|---|
| **Funkcionalnost** | F7 - Preverjanje pravil financiranega računa |
| **Vloga** | Trgovec |
| **MVP** | Da (domensko) |

Kot trgovec želim preveriti, ali izbrana strategija izpolnjuje vnaprej določena pravila financiranih računov, da se lahko odločim ali je investicija v račun sploh smiselna.

**Acceptance criteria**
1. Pri zagonu testa lahko trgovec izbere načrt financiranega računa (`prop_plans`). Izbira je neobvezna.
2. Če je načrt izbran, rezultati prikažejo za vsako pravilo (cilj dobička, največja dnevna izguba, največja skupna izguba) dosežen in dovoljen znesek ter oznako Izpolnjeno/Kršeno.
3. Če je kršeno pravilo o dnevni ali skupni izgubi, sistem prikaže datum prve kršitve in jo označi na krivulji vrednosti računa; test se vseeno izvede do konca obdobja.
4. Sistem shrani skupni izid v `challenge_passed` (`true` samo, če so vsa tri pravila izpolnjena). Brez izbranega načrta ostane vrednost prazna in razdelek ni prikazan.
5. Za isti test z isto strategijo in različnima načrtoma sistem prikaže različne izide preverjanja.

---

### US-09: Primerjava testov

| | |
|---|---|
| **Funkcionalnost** | F8 - Primerjava testov ali nastavitev |
| **Vloga** | Trgovec |
| **MVP** | Ne |

Kot trgovec želim primerjati rezultate večjega nabora strategij, da lahko iz rezultatov izberem najboljšo konfiguracijo.

**Acceptance criteria**
1. Uporabnik na seznamu svojih testov izbere od 2 do 4 teste in odpre primerjavo. Pri izbiri manj kot 2 ali več kot 4 testov je gumb onemogočen s pojasnilom.
2. Primerjava v tabeli prikaže za vsak test strategijo, parametre, sredstva, borzo, obdobje, neto dobiček, donosnost, število poslov, največji padec in izid preverjanja financiranega računa.
3. Pri vsaki številčni metriki je najboljša vrednost vizualno označena.
4. Krivulje vrednosti računa izbranih testov so prikazane na skupnem grafu z legendo.
5. V primerjavi je mogoče uporabiti samo teste, ki jih uporabnik sme videti (P1).

---

### US-10: Deljenje strategij in testov

| | |
|---|---|
| **Funkcionalnost** | F9 - Deljenje strategij in testov |
| **Vloga** | Trgovec |
| **MVP** | Ne |

Kot trgovec želim svojo strategijo označiti kot javno oz. zasebno, da s tem omogočim zasebni dostop ali pa deljenje z drugimi.

**Acceptance criteria**
1. Lastnik lahko `visibility` svoje strategije ali testa preklopi med `private` in `shared`; pred deljenjem sistem zahteva potrditev.
2. Deljena strategija se pojavi v seznamu drugih trgovcev (US-03), ki jo lahko uporabijo za svoj test, ne morejo pa je urejati ali brisati (`403`).
3. Deljeni test je drugim uporabnikom viden samo za branje, brez možnosti spremembe `params` in `results`.
4. Ko lastnik ponovno nastavi `private`, strategija ali test takoj izgine iz seznamov drugih. Testi, ki so jih drugi že izvedli s to strategijo, ostanejo v njihovi lasti.
5. Novo ustvarjena strategija in novo ustvarjen test sta privzeto `private`.

---

### US-11: Povezava mentor–trgovec z vabilom

| | |
|---|---|
| **Funkcionalnost** | F10 - Povezava trgovec–mentor z vabilom |
| **Vloga** | Mentor (vabi), Trgovec (odgovori) |
| **MVP** | Ne (odvisnost za US-12) |

Kot mentor želim povabiti trgovca v svojo skupino, da mu lahko nudim podporo, priporočila in spremljam njegove rezultate.

**Acceptance criteria**
1. Mentor vnese e-naslov registriranega trgovca. Če uporabnik ne obstaja ali nima vloge Trgovec, sistem vabila ne ustvari in prikaže razlog.
2. Ob uspešnem vabilu sistem ustvari zapis v `mentor_links` s stanjem `invited`; ponovno vabilo istemu trgovcu je zavrnjeno (par `mentor_id`, `trader_id` je enoličen).
3. Trgovec vidi čakajoča vabila z imenom mentorja in jih lahko sprejme (`active`) ali zavrne (`declined`).
4. Trgovec z že aktivnim mentorjem ne more sprejeti drugega vabila; sistem prikaže »Že imate aktivnega mentorja«.
5. Mentor lahko učenca odstrani (`ended`), po tem mentor ne vidi več njegovih testov. Povezavo lahko prekine tudi trgovec.

---

### US-12: Oddaja testa mentorju v pregled

| | |
|---|---|
| **Funkcionalnost** | F11 - Oddaja testa mentorju v pregled |
| **Vloga** | Trgovec |
| **MVP** | Da (domensko) |

Kot trgovec želim oddati svoj test mentorju v vpogled in imeti pregled nad njegovimi komentarji, da dobim povratno informacijo s strani strokovnjaka.

**Acceptance criteria**
1. Gumb »Oddaj mentorju« je aktiven samo za lasten test v stanju `draft`, in samo če ima trgovec povezavo `active`. Sicer je onemogočen s pojasnilom »Najprej se poveži z mentorjem« (US-11).
2. Ob oddaji (`POST /api/backtests/:id/submit`) se stanje spremeni iz `draft` v `submitted`, `reviewer_id` se nastavi na mentorja, v `status_history` se zapiše prehod s časom in uporabnikom.
3. Dokler je test v stanju `submitted`, ga lahko trgovec umakne (`withdrawn`); v stanju `in_review` umika ni mogoče izvesti.
4. Ko mentor zahteva spremembe (`changes_requested`), trgovec s »Ponovi test« ustvari nov test z istimi nastavitvami, ki ima `previous_id` na prejšnji test, v stanju `draft`.
5. Trgovec ob testu vidi trenutno stanje in vse mentorjeve komentarje samo za branje, napake so vizualno označene.

---

### US-13: Mentorjev dashboard in začetek pregleda

| | |
|---|---|
| **Funkcionalnost** | F12 - Mentorjev dashboard, komentarji in beleženje napak |
| **Vloga** | Mentor |
| **MVP** | Da (domensko) |

Kot mentor želim na enem dashboardu videti rezultate svojih učencev, da imam centraliziran nadzor in pregled vseh učencev.

**Acceptance criteria**
1. Dashboard prikaže seznam aktivnih učencev s številom vseh testov in številom testov v stanju `submitted`.
2. Seznam testov je mogoče filtrirati po stanju (`submitted`, `in_review`, `changes_requested`, `approved`) in ima paginacijo po 20 testov.
3. Mentor lahko odpre test svojega aktivnega učenca in vidi rezultate, parametre in stroške samo za branje. Polj `params` in `results` ne more spreminjati (`403`).
4. Z »Začni pregled« (`POST /api/backtests/:id/start-review`) se stanje spremeni iz `submitted` v `in_review`, prehod se zapiše v `status_history`.
5. Zasebnih testov uporabnikov, ki niso njegovi aktivni učenci, mentor ne vidi (`404`, P1); testi odstranjenega učenca (`ended`) mentorju niso več vidni.

---

### US-14: Komentarji, napake in odločitev o testu

| | |
|---|---|
| **Funkcionalnost** | F12 - Mentorjev dashboard, komentarji in beleženje napak |
| **Vloga** | Mentor |
| **MVP** | Da (domensko) |

Kot mentor želim imeti možnost komentiranja, ocenjevanja in sprejemanja odločitev za vsak test svojih učencev, da s tem omogočim posredovanje mnenja in priporočil.

**Acceptance criteria**
1. Mentor lahko doda komentar (1–2000 znakov) samo k testu, kjer je `reviewer_id`, in samo v stanju `in_review`. Prazen komentar je zavrnjen.
2. Komentar je mogoče označiti kot napako (`is_mistake = true`); označeni komentarji so v pregledu testa izpisani ločeno od običajnih z rdečo oznako.
3. »Zahtevaj spremembe« (`/request-changes`) je mogoče izvesti samo, če test vsebuje vsaj en komentar; stanje preide v `changes_requested`.
4. »Odobri« (`/approve`) spremeni stanje v `approved`; po tem komentarjev ni več mogoče dodajati.
5. Vsak prehod stanja je zapisan v `status_history`; trgovec komentarjev ne more dodajati, spreminjati ali brisati.

---

### US-15: Skupna analitika učencev

| | |
|---|---|
| **Funkcionalnost** | F13 - Skupna analitika učencev |
| **Vloga** | Mentor |
| **MVP** | Ne |

Kot mentor želim videti vso zbrano statistiko učencev, da lahko nad njo izvedem ustrezno analizo.

**Acceptance criteria**
1. Analitika (`GET /api/mentor/students/analytics`) vključuje samo aktivne učence mentorja.
2. Za vsakega učenca prikaže število testov, delež odobrenih testov, število zabeleženih napak (`is_mistake = true`) in povprečni največji padec kapitala.
3. Prikazana je tudi skupna vsota in povprečje čez vse učence.
4. Obdobje je mogoče omejiti (zadnjih 30 dni, zadnjih 90 dni, vse); privzeto je »vse«. **[PREDPOSTAVKA]** nabor obdobij
5. Če mentor nima aktivnih učencev ali učenec nima testov, sistem prikaže prazno stanje namesto napake ali ničelnih povprečij.

---

### US-16: Vzdrževanje referenčnih podatkov

| | |
|---|---|
| **Funkcionalnost** | F14 - Vzdrževanje podatkov in uporabnikov |
| **Vloga** | Administrator |
| **MVP** | Ne |

Kot administrator želim dodajati in posodabljati podatke, sredstva, borze in pravila financiranih računom, da zagotovim ažuriranost podatkov.

**Acceptance criteria**
1. Administrator lahko ustvari, uredi in izbriše zapise `instruments`, `venues` in `prop_plans` prek obrazcev (`/api/admin/...`).
2. Obvezna polja morajo biti izpolnjena; provizije (`maker_pct`, `taker_pct`) in zneski (`account_size`, `max_daily_loss`, `max_total_loss`, `profit_target`) morajo biti števila, večja ali enaka 0.
3. Če je zapis uporabljen v vsaj enem testu, ga sistem ne izbriše in prikaže število testov, ki ga uporabljajo.
4. Sprememba borze ali načrta ne vpliva na že shranjene rezultate testov (P8).
5. Trgovec in mentor ne moreta spreminjati referenčnih podatkov (`403`), vidita pa jih pri izbiri v US-05 in US-08.

---

### US-17: Upravljanje uporabniških računov

| | |
|---|---|
| **Funkcionalnost** | F14 - Vzdrževanje podatkov in uporabnikov |
| **Vloga** | Administrator |
| **MVP** | Ne |

Kot administrator želim ustvarjati, blokirati in manipulirati z podatki in vlogami uporabnikov, da s tem zagotovim varno prehajanje med vlogami in uporabo.

**Acceptance criteria**
1. Seznam uporabnikov (`GET /api/admin/users`) prikazuje ime, e-naslov, vlogo in stanje računa, ima iskanje po imenu ali e-naslovu in paginacijo po 20 zapisov.
2. Administrator lahko račun blokira ali odblokira (`PATCH /api/admin/users/:id`); blokiran uporabnik se ne more prijaviti, njegov obstoječ žeton pa najkasneje pri naslednjem zahtevku ne velja več.
3. Administrator lahko uporabniku spremeni vlogo na `trader`, `mentor` ali `admin`; sprememba se upošteva ob naslednji prijavi.
4. Administrator ne more blokirati samega sebe ali odstraniti vloge `admin` zadnjemu administratorju; sistem prikaže razlog.
5. Administrator ne vidi zasebnih strategij in testov uporabnikov (P1, `404`).
