---
status: "accepted"
date: 2026-10-21
decision-makers: Matic Kuhar
---

# Preverjanje vlog in lastništva na backendu

## Kontekst in opis problema
Platforma ima vloge `trader`, `mentor` in `admin` ter stroga pravila vidnosti: zasebne strategije in teste vidi samo lastnik, mentor pa samo teste svojih učencev. Odločiti je treba, kje se pravila preverjajo.

## Obravnavane možnosti
* Preverjanje na backendu ob vsakem zahtevku
* Preverjanje na frontendu (skrivanje gumbov in strani)
* Preverjanje v bazi (Row Level Security)

## Rezultat odločitve
Izbrana možnost: »Preverjanje na backendu«, ker frontendu ni mogoče zaupati: uporabnik lahko pokliče API neposredno. Vsako dejanje se preveri glede na vlogo in lastništvo. Frontend lahko nedovoljene gumbe skrije le kot dopolnilo, RLS pa bi zahteval zahtevnejšo konfiguracijo baze.

### Posledice
* Dobro, ker pravil ni mogoče zaobiti z neposrednim klicem API-ja in so na enem mestu.
* Dobro, ker frontend ostane brez poslovne logike.
* Slabo, ker mora preverjanje izvesti vsak endpoint, pozabljeno preverjanje pa pomeni varnostno luknjo.
* Slabo, ker so potrebni testi za vse kombinacije vlog in lastništva.
