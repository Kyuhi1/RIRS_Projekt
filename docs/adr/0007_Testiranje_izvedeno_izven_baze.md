---
status: "accepted"
date: 2026-10-21
decision-makers: Matic Kuhar
---

# Izračun testa je ločen od baze

## Kontekst in opis problema
Izvajalec testov izračuna rezultat strategije na zgodovinskih podatkih. Odločiti je treba, ali ima izvajalec sam dostop do baze ali mu backend poda podatke in prejme rezultat.

## Obravnavane možnosti
* Izvajalec brez dostopa do baze (vhod in izhod prek backenda)
* Izvajalec z neposrednim dostopom do baze
* Izračun v SQL poizvedbah

## Rezultat odločitve
Izbrana možnost: »Izvajalec brez dostopa do baze«, ker dobi podatke od strežnika in vrne rezultat. Ločeno se lažje testira in ne more po nesreči spreminjati podatkov. Izračun v SQL bi težko izrazil zapletena pravila strategij, svečke pa v bazi niti niso.

### Posledice
* Dobro, ker je izračun čista funkcija (vhod → rezultat), kar poenostavi testiranje.
* Dobro, ker se izvajalec lahko kasneje preseli v samostojno storitev ali vrsto opravil za vzporedne ali daljše teste.
* Slabo, ker mora backend podatke pripraviti in posredovati, kar je dodatno delo.
* Slabo, ker prenos podatkov med procesoma poveča porabo pomnilnika in lahko upočasni izvedbo.
