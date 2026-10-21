---
status: "accepted"
date: 2026-10-21
decision-makers: Matic Kuhar
---

# Čisti SQL z odjemalcem `pg` brez ORM

## Kontekst in opis problema
Backend mora brati in pisati v PostgreSQL. Odločiti je treba, ali uporabiti ORM ali neposredno pisati poizvedbe SQL.

## Obravnavane možnosti
* Čisti SQL z odjemalcem `pg`
* ORM (npr. Prisma ali TypeORM)
* Graditelj poizvedb (npr. Knex)

## Rezultat odločitve
Izbrana možnost: »Čisti SQL z odjemalcem `pg`«, ker je shema majhna in jasna, `pg` in SQL pa zadoščata. Manj ogrodij pomeni manj odvisnosti, ORM pa bi dodal plast abstrakcije, ki je za to shemo nepotrebna.

### Posledice
* Dobro, ker imamo popoln nadzor nad poizvedbami in transakcijami (npr. atomarni prehodi stanj testa).
* Dobro, ker je manj odvisnosti, poizvedbe pa so berljive in jih je lažje optimizirati.
* Slabo, ker je treba ročno pisati poizvedbe in preslikavo v objekte, kar pomeni več kode.
* Slabo, ker ni samodejnih migracij, zato jih urejamo sami, uporabo parametriziranih poizvedb pa je treba nadzorovati zaradi SQL injection.
