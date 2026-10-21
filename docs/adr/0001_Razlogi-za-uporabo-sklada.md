---
status: "accepted"
date: 2026-10-21
decision-makers: Matic Kuhar
---

# Nadaljevanje z obstoječim skladom (Vite, Node.js, PostgreSQL, Docker)

## Kontekst in opis problema
Backtester že ima delujočo osnovo na skladu Vite, Node.js, PostgreSQL in Docker. Pred razvojem novih funkcionalnosti (tri vloge, delovni proces pregleda testa) je treba odločiti, ali s skladom nadaljujemo ali ga zamenjamo.

## Obravnavane možnosti
* Nadaljevanje z obstoječim skladom
* Popoln prepis v drug sklad (npr. Java s Spring Boot)
* Izolirana sprememba (samo frontend ali samo backend)

## Rezultat odločitve
Izbrana možnost: »Nadaljevanje z obstoječim skladom«, ker je že implementiran in preizkušen, zato se čas porabi za vloge in delovni proces, ne za ponovno postavljanje osnove. Prepis bi prinesel malo nove vrednosti za uporabnika, delen prepis pa bi povečal raznolikost tehnologij.

### Posledice
* Dobro, ker se razvoj novih funkcionalnosti lahko začne takoj, tveganja sklada pa so že znana.
* Dobro, ker ostane znana zasnova z Dockerjem in zagonom z enim ukazom.
* Slabo, ker smo vezani na obstoječe odločitve in jih je kasneje dražje spremeniti.
* Slabo, ker morebitne pomanjkljivosti obstoječe zasnove prenesemo v nov razvoj.
