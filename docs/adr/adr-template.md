---
# To so neobvezni metapodatki. Poljubno jih odstranite.
status: "{proposed | rejected | accepted | deprecated | … | superseded by ADR-0123}"
date: {YYYY-MM-DD, ko je bila odločitev nazadnje posodobljena}
decision-makers: {seznam vseh, ki so sodelovali pri odločitvi}
consulted: {seznam vseh, katerih mnenje je bilo zaprošeno (običajno strokovnjaki za področje); z njimi poteka dvosmerna komunikacija}
informed: {seznam vseh, ki so sproti obveščeni o napredku; z njimi poteka enosmerna komunikacija}
---

# {kratek naslov, ki predstavlja rešen problem in najdeno rešitev}

## Kontekst in opis problema
{Opišite kontekst in problem, npr. v prosti obliki z dvema do tremi stavki ali v obliki ponazoritvene zgodbe. Problem lahko zastavite kot vprašanje. Razmislite o povezavah na skupne table ali sisteme za upravljanje nalog. Obseg odločitve naj bo jasen, npr. z navedbo ali sklicem na strukturne elemente arhitekture (komponente, povezave, ...).}

<!-- To je neobvezen element. Poljubno ga odstranite. -->
## Dejavniki odločitve
* {dejavnik odločitve 1, npr. želena kakovost programske opreme, zaznana skrb, omejitev ali sila}
* {dejavnik odločitve 2}
* … <!-- število dejavnikov je lahko poljubno -->

## Obravnavane možnosti
* {naziv možnosti 1}
* {naziv možnosti 2}
* {naziv možnosti 3}
* … <!-- število možnosti je lahko poljubno -->

## Rezultat odločitve
Izbrana možnost: »{naziv možnosti 1}«, ker {utemeljitev, npr. edina možnost, ki izpolnjuje izločitveni kriterij | rešuje silo {sila} | … | je najboljša (glej spodaj)}.

<!-- To je neobvezen element. Poljubno ga odstranite. -->
### Posledice
* Dobro, ker {pozitivna posledica, npr. izboljšanje ene ali več želenih kakovosti, …}
* Slabo, ker {negativna posledica, npr. poslabšanje ene ali več želenih kakovosti, …}
* … <!-- število posledic je lahko poljubno -->

<!-- To je neobvezen element. Poljubno ga odstranite. -->
### Potrditev
{Opišite, kako je mogoče ali bo mogoče potrditi izvedbo oziroma skladnost z ADR. Ali obstaja samodejna ali ročna funkcija ustreznosti (fitness function)? Če da, jo navedite in razložite, kako se uporablja. Ali sta izbrana zasnova in njena izvedba skladni z odločitvijo? Pri preverjanju lahko pomaga npr. pregled zasnove ali kode ali test z knjižnico, kot je ArchUnit. Čeprav ta element štejemo za neobveznega, je vključen v številnih ADR.}

<!-- To je neobvezen element. Poljubno ga odstranite. -->
## Prednosti in slabosti možnosti

### {naziv možnosti 1}
<!-- To je neobvezen element. Poljubno ga odstranite. -->
{primer | opis | povezava na več informacij | …}

* Dobro, ker {argument a}
* Dobro, ker {argument b}
<!-- uporabite »Nevtralno«, kadar argument ne govori ne za ne proti -->
* Nevtralno, ker {argument c}
* Slabo, ker {argument d}
* … <!-- število prednosti in slabosti je lahko poljubno -->

### {naziv druge možnosti}
{primer | opis | povezava na več informacij | …}

* Dobro, ker {argument a}
* Nevtralno, ker {argument b}
* Slabo, ker {argument c}
* …

<!-- To je neobvezen element. Poljubno ga odstranite. -->
## Dodatne informacije
{Tu lahko navedete dodatne dokaze oziroma zaupanje v rezultat odločitve in/ali dokumentirate soglasje ekipe, določite, kdaj in kako naj se odločitev izvede ter ali in kdaj naj se ponovno preuči. Tu so lahko tudi povezave na druge odločitve in vire.}
