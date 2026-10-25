---
status: "accepted"
date: 2026-10-21
decision-makers: Matic Kuhar
---

# Cenovni podatki (svečke) ostanejo v datotekah Parquet

## Kontekst in opis problema
Backtest bere večletne cenovne podatke, ki so veliki in se samo berejo. Odločiti je treba, ali jih naložiti v PostgreSQL ali hraniti v datotekah.

## Obravnavane možnosti
* Datoteke Parquet, ki jih bere DuckDB
* Tabela s zgodovino v PostgreSQL
* Datoteke CSV

## Rezultat odločitve
Izbrana možnost: »Datoteke Parquet, ki jih bere DuckDB«, ker gre za velike količine podatkov, ki se samo berejo. Baza bi se po nepotrebnem povečala in upočasnila, CSV pa je večji in počasnejši za branje.

### Posledice
* Dobro, ker PostgreSQL ostane majhen in hiter, Parquet pa je primeren za hitro branje večjih obdobij.
* Dobro, ker se podatki posodabljajo neodvisno od baze (Python skripte).
* Slabo, ker so podatki na dveh mestih, zato ni skupnih transakcij in je treba varnostno kopirati oboje.
* Slabo, ker velike datoteke ne spadajo v Git in jih je treba upravljati ločeno.
