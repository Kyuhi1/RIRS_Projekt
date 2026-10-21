---
status: "accepted"
date: 2026-10-21
decision-makers: Matic Kuhar
---

# Seja z JWT v piškotku `httpOnly`

## Kontekst in opis problema
Backend mora ob vsakem zahtevku prepoznati uporabnika in njegovo vlogo. Odločiti je treba, kakšen žeton uporabiti in kje ga brskalnik hrani.

## Obravnavane možnosti
* JWT v piškotku `httpOnly`
* JWT v `localStorage`
* Seja, shranjena v bazi

## Rezultat odločitve
Izbrana možnost: »JWT v piškotku `httpOnly`«, ker žeton ni dostopen skriptam v brskalniku, kar zmanjša tveganje kraje z XSS, strežnik pa ne potrebuje seznama sej. Pri `localStorage` bi žeton lahko ukradla vsaka vsiljena skripta, seja v bazi pa zahteva poizvedbo ob vsakem zahtevku.

### Posledice
* Dobro, ker JavaScript na strani ne more prebrati žetona.
* Dobro, ker backend sejo preveri samo s podpisom, brez poizvedbe v bazo.
* Slabo, ker piškotki zahtevajo zaščito pred CSRF (npr. `SameSite`).
* Slabo, ker je predčasna prekinitev seje (npr. blokiran račun) težja; rešitev sta kratka veljavnost žetona in preverjanje polja `blocked`.
