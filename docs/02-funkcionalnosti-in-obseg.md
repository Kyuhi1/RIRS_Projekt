## Uporabniške vloge

### Trgovec
Je glavni uporabnik platforme, ki izvaja trgovanje, testiranje in primerjavo različnih konfiguracij strategij.

**Lahko:**
- Upravlja svoje strategije in tuje javne strategije (nalaganje, nastavitve, brisanje),
- Izvaja teste in primerja rezultate s stroški borz in pravili financiranih računov,
- Svoje strategije in teste označi kot zasebne ali javne,
- Vidi teste drugih uporabnikov in uporabi njihove strategije, če je lastnik to dovolil,
- Sprejme ali zavrne mentorjevo vabilo v skupino.

**Ne more:**
- Videti ali uporabiti zasebnih strategij in testov drugih uporabnikov,
- Spreminjati strategij, nastavitev in rezultatov drugih uporabnikov,
- Upravljati trgovskih podatkov (finančna sredstva, borze, stroški, pravila) in drugih uporabnikov.

### Mentor
Je učitelj, ki ima pod seboj skupino trgovcev (svojih učencev), katere uči oz. sledi njihovemu napredku.

**Lahko:**
- Doda učenca (z vabilom) ali pa tega odstrani iz skupine,
- Kontaktira učence neposredno ali preko komentarjev,
- Pregleda teste, strategije in statistiko svojih učencev,
- Komentira teste in beleži napake,
- Uporablja analitiko svojih učencev.

**Ne more:**
- Spreminjati strategij, nastavitev in rezultatov svojih učencev,
- Videti zasebne vsebine trgovcev, ki niso njegovi učenci,
- Upravljati referenčnih podatkov in uporabnikov.

### Administrator
Skrbi za podatke, njihovo ažurnost in upravlja uporabnike platforme.

**Lahko:**
- Vzdržuje podatke: finančna sredstva, borze, stroške trgovanja in pravila podjetij za financiranje trgovcev,
- Upravlja z uporabniškimi računi (ustvarjanje, blokiranje, dodelitev vloge).

**Ne more:**
- Izvajati testov,
- Videti ali spreminjati zasebnih strategij in rezultatov uporabnikov,
- Komentirati testov kot mentor.

## Predvidene funkcionalnosti
Funkcionalnosti, označene z **MVP**, so del prve delujoče različice. Oznaka **domensko** pomeni, da je funkcionalnost značilna za platformo Backtester.

| # | Funkcionalnost | Vloga | MVP |
|---|---|---|---|
| F1 | Registracija, prijava in prepoznava vloge | vsi | MVP | 
| F2 | Pregled obstoječih in deljenih strategij | trgovec | | 
| F3 | Nalaganje in nastavitev lastne strategije | trgovec | MVP | 
| F4 | Izbira sredstev, borze in obdobja ter zagon testa | trgovec | MVP, domensko | 
| F5 | Prikaz rezultatov testa | trgovec | | 
| F6 | Upoštevanje stroškov izbrane borze | trgovec | MVP, domensko | 
| F7 | Preverjanje pravil financiranega računa | trgovec | MVP, domensko | 
| F8 | Primerjava testov ali nastavitev | trgovec | | 
| F9 | Deljenje strategij in testov | trgovec | | 
| F10 | Povezava trgovec–mentor z vabilom | mentor, trgovec | | 
| F11 | Oddaja testa mentorju v pregled | trgovec | MVP, domensko | 
| F12 | Mentorjev dashboard, komentarji in beleženje napak | mentor | MVP, domensko | 
| F13 | Skupna analitika učencev | mentor | | 
| F14 | Vzdrževanje podatkov in uporabnikov | administrator | | 

## Kasnejše nadgradnje
- Samodejna optimizacija parametrov strategije (iskanje najboljših nastavitev z uporabo pametnih agentov).
- Obvestila po e-pošti ob oddaji testa, komentarju in spremembi stanja.
- Več mentorjev na učenca in skupine učencev.
- Izvoz poročila testa in mentorjevih komentarjev v PDF.
- Javna lestvica deljenih strategij po profitabilnosti.

## Izven obsega
- Pravo trgovanje: izvajanje poslov na borzi ali povezava z računom pri brokerju.
- Podatki v realnem času in živo trgovanje, platforma dela le z zgodovinskimi podatki.
- Plačila, naročnine in zaračunavanje uporabe.