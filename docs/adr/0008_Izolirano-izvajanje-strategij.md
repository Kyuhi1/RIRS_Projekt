---
status: "accepted"
date: 2026-10-21
decision-makers: Matic Kuhar
---

# Naložene strategije se izvajajo izolirano

## Kontekst in opis problema
Strategijo naloži uporabnik, zato je njena koda nezaupanja vredna: lahko je počasna (neskončna zanka), porabi preveč pomnilnika ali poskuša dostopati do baze, datotek in omrežja. Odločiti je treba, kako se taka koda izvaja.

## Obravnavane možnosti
* Ločen delavec (worker) brez dostopa do baze, datotečnega sistema in omrežja, z omejitvijo časa in pomnilnika
* Izvajanje v istem procesu kot backend
* Poseben kontejner za vsak test

## Rezultat odločitve
Izbrana možnost: »Ločen delavec z omejitvami«, ker koda uporabnika tako ne more dostopati do baze, datotek in omrežja, poraba virov pa je omejena. Izvajanje v istem procesu bi kodi dalo dostop do vsega, kar ima backend, kontejner za vsak test pa je za ta projekt prezahteven.

### Posledice
* Dobro, ker napaka ali zloraba v strategiji ne more neposredno prizadeti baze ali strežnika.
* Dobro, ker omejitev časa in pomnilnika prepreči neskončne zanke in prekomerno porabo virov.
* Slabo, ker izolacija znotraj procesa Node.js ni popolna varnostna meja in zahteva skrbno konfiguracijo.
* Slabo, ker omejitve lahko ovirajo legitimne strategije, ki potrebujejo veliko virov.
