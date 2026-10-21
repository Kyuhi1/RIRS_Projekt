---
status: "accepted"
date: 2026-10-21
decision-makers: Matic Kuhar
---

# PostgreSQL kot podatkovna baza

## Kontekst in opis problema
Podatki (uporabniki, strategije, testi, komentarji, povezave mentor–učenec) so močno povezani, delovni proces pregleda testa pa zahteva atomarne prehode stanj. Odločiti je treba, v kakšni bazi jih hraniti.

## Obravnavane možnosti
* PostgreSQL
* MongoDB (dokumentna baza)
* SQLite (datoteka)

## Rezultat odločitve
Izbrana možnost: »PostgreSQL 16«, ker so podatki relacijski in so potrebni tuji ključi, transakcije in omejitve. MongoDB bi omejitve in povezave prenesla v aplikacijo, SQLite pa slabše podpira sočasno pisanje. PostgreSQL tudi omogoča delo z parquet.

### Posledice
* Dobro, ker tuji ključi in transakcije zagotavljajo veljavne podatke in atomarne prehode stanj testa.
* Dobro, ker je PostgreSQL zrela in razširjena tehnologija, zato ima rešitev predvidljiv vzdrževalni odtis.
* Slabo, ker zahteva ločeno storitev in volumen (Docker, varnostne kopije).
* Slabo, ker je treba shemo in njene spremembe skrbno načrtovati.
