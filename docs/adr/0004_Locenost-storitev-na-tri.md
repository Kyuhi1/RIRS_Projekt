---
status: "accepted"
date: 2026-10-21
decision-makers: Matic Kuhar
---

# Tri ločene storitve (frontend, backend, baza)

## Kontekst in opis problema
Aplikacija potrebuje spletni vmesnik, poslovno logiko in trajno shrambo za tri uporabniške vloge. Odločiti je treba, kako te dele razporediti in zagnati.

## Obravnavane možnosti
* Tri ločene storitve v Docker Compose
* Monolit, ki streže tudi frontend
* Frontend z neposrednim dostopom do baze

## Rezultat odločitve
Izbrana možnost: »Tri ločene storitve«, ker je vsak del neodvisen in ga je mogoče zamenjati ali razširiti, lokalni zagon pa ostane en ukaz (`docker compose up`). Neposreden dostop frontenda do baze bi težko zagotovil pravila lastništva in delovni proces.

### Posledice
* Dobro, ker je frontend samo statični build brez poslovne logike, vsa pravila pa so na backendu.
* Dobro, ker se posamezna storitev (npr. izvajalec testov) lahko kasneje razširi ali zamenja.
* Slabo, ker je treba upravljati več kontejnerjev in njihovo povezovanje (proxy `/api/*`).
* Slabo, ker zahtevki potujejo čez več členov, kar oteži iskanje napak.
