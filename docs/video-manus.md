# SEANSEN – Konsulent-orakelet: manus til 5-minutters video

**Totalt ca. 650 ord, 5:00. Grensen er hard, alt over kuttes.** Replikkene er et utgangspunkt. Snakk fritt ut fra stikkordene i stedet for å lese opp.

> Tallet «X timer per uke» i første del er ikke funnet på. Fyll inn et eget tall hvis dere har et ekte, ellers dropp det.

| Tid | Del |
|---|---|
| 0:00–0:30 | Problem og hvem det gjelder |
| 0:30–1:00 | Løsningen i én setning |
| 1:00–3:30 | Live-demo |
| 3:30–4:15 | Hvordan det er bygget |
| 4:15–4:45 | Verdi og læring |
| 4:45–5:00 | Avslutning |

---

## 0:00–0:30 · Problem og hvem det gjelder

**På skjermen:** Tittelkort med «SEANSEN – Konsulent-orakelet», lagnavn og prosjektnavn `[fyll inn]`.

> «Når et oppdrag trenger folk, må noen lete i kompetanseprofiler, sjekke hvem som er ledige, lese CV-er og se på hva folk faktisk har gjort. Det er flere kilder og mye manuelt arbeid. Det rammer bemanningsansvarlige og ledere, hver gang det kommer et nytt behov. `[Bruk bare et tall hvis dere har et ekte: «X timer per uke».]`»

## 0:30–1:00 · Løsningen i én setning

**På skjermen:** Forsiden med portrettet og søkefeltet.

> «Seansen er en bemanningsagent: du beskriver behovet på vanlig norsk, og agenten finner kandidatene, viser hvem som er ledige, og lager en opplæringsplan med tidsplan for dem som nesten treffer. Du bygger teamet selv, og agenten husker samtalen.»

**Det som er annerledes:** Gapanalysen og opplæringsplanen, og at du bygger et team over flere søk.

---

## 1:00–3:30 · Live-demo (150 sekunder)

**Forberedelser:** Server startet, nettleseren åpen på forsiden, tom Team Repository. Bruk syntetiske data, som er standard.

| Tid | Gjør | Si (stikkord) |
|---|---|---|
| 1:00–1:35 | Skriv: *«Vi trenger en Kubernetes-ekspert som også kan Terraform på høyt nivå, ledig fra november.»* Pek på tenkeboblen som viser verktøykallene («🔍 Søker i kompetanseprofilene…», «Sjekker hvem som er ledige», «Regner ut gap og opplæringsplan»). | «Nå stiller jeg et vanlig spørsmål. Se hva agenten gjør: den søker i kompetanse, sjekker tilgjengelighet og regner ut gap. Det er verktøykall, ikke en chatbot som gjetter.» |
| 1:35–2:05 | Svaret kommer. Vis kortene først, så detaljene: grad, faglig match, grønn «Ledig». Zoom på **«Nesten!»**-blokken med tidslinjen. | «Her er tre kandidater. Ingen er perfekt, så agenten sier hva som mangler: Kubernetes fra 4 til 5. Planen viser kurset, datoene og om de er klare før de blir ledige. Tallene regnes ut av serveren fra dataene, ikke av modellen.» |
| 2:05–2:15 | Klikk på to kort. De havner i **Mitt Team**. | «Jeg velger selv hvem som kommer i teamet, ved å klikke.» |
| 2:15–2:45 | **Grensesituasjonen.** Skriv: *«Nå trenger vi også en som kan React.»* | «Neste søk. Teamet står, og agenten husker alt. Her finnes ingen perfekt match: agenten sier at ingen er ledige i november og at den nærmeste kommer en måned senere. Den later ikke som noe annet.» |
| 2:45–3:05 | Skriv: *«Hva mangler teamet vårt hvis vi skal levere fra sky til frontend?»* | «Agenten ser teamet mitt og svarer på hva som mangler.» |
| 3:05–3:20 | Skriv **«Wingardium Leviosa»**. Teamet svever og flyr inn i Team Repository. | «Når teamet er ferdig, løfter jeg det inn i Team Repository, og kan bygge et nytt.» |
| 3:20–3:30 | Skriv **«Obliviate»**. Vinduet flyr ut av skjermen. | «Obliviate sletter samtalen og teamet. Ren start.» |

### Tips til opptaket

- Agent-kjøringene kan ta rundt et halvt minutt eller mer. Det er ikke målt nøyaktig. Ta opp i ett strekk, kutt eller speil opp ventetiden i klippingen, og si «her har vi spolt fremover».
- Hvis ett søk uteblir eller feiler under opptaket, bruk et ferdig kjørt opptak av det søket og si fra at det er det.
- Verktøykallene vises i en tenkeboble som forsvinner når svaret kommer. Pause på dem et øyeblikk, ellers rekker ikke seerne å se dem.
- Resultatene fra modellen varierer. Øv to ganger, og se hvilke kandidater som dukker opp før dere sier navn.
- Ingen ekte navn, CV-er eller kundedata i bildet. All data i løsningen er syntetisk.

---

## 3:30–4:15 · Hvordan det er bygget

**På skjermen:** Ett bilde.

```
Nettleser (HTML/JS)  ──►  Python-server  ──►  Claude (agentløkke)
  søk · team · plan          API + minne           │ kaller verktøy
                                                   ▼
        sok_kompetanse · sjekk_tilgjengelighet · hent_cv
        finn_prosjekthistorikk · finn_kurs · gap_analyse
                                                   ▼
        80 syntetiske konsulenter · tilgjengelighet · CV · prosjekter · 89 kurs
```

> «Agenten har seks verktøy: søk i kompetanse, tilgjengelighet, CV, prosjekthistorikk, kurskatalog og gapanalyse. Det viktigste designvalget er arbeidsdelingen. Modellen bestemmer hva den skal slå opp og skriver begrunnelsen. Serveren regner ut gap, datoer og planer fra dataene, så tallene alltid stemmer. Og mennesket velger hvem som kommer i teamet. Agenten foreslår, du bestemmer.»

---

## 4:15–4:45 · Verdi og læring

**På skjermen:** Tre stikkord: *Bedre · Ikke bra · Neste*.

> «Det som ble bedre: ett spørsmål erstatter flere oppslag, og du ser hva som mangler og når de er klare. Det som ikke fungerte like bra: modellen fulgte ikke alltid lengde- og formatkrav, så vi flyttet oppsummeringen inn i et fast felt. Hvor høyt den setter nivået for «ekspert», er også modellens tolkning. Og minnet ligger bare i serveren mens den kjører. Alle data er syntetiske, og kurskatalogen er laget av oss. Neste steg er å koble på ekte kilder.»

---

## 4:45–5:00 · Avslutning

> «Neste steg er ekte data, men CV-er og profiler er personopplysninger, så da må personvernombudet involveres først. Seansen kan brukes av alle som bemanner team, og den kjører uten byggesteg. Takk!»

---

**Før videoen deles:** Gå gjennom innholdet og sjekk at påstander og tall stemmer med det som faktisk vises. Teksten er et utkast og er ikke validert av teamet.
