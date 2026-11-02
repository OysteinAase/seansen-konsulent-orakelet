"""Seansen uten Node.js: samme agent og samme API som src/server.js, skrevet i Python.

  POST /api/match            streamer agentens arbeid som NDJSON (én JSON-hendelse per linje)
  GET  /api/konsulenter/<id> profil, tilgjengelighet, prosjekter og CV til én konsulent
  GET  /                     frontenden i python/web (ingen byggesteg)

Start: python python/server.py   (krever ANTHROPIC_API_KEY i miljøet eller i .env)
"""
import json
import math
import os
import re
import sys
import threading
from collections import OrderedDict
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import anthropic

sys.stdout.reconfigure(encoding="utf-8")

ROT = Path(__file__).resolve().parent.parent
DATA = ROT / "data"
WEB = Path(__file__).resolve().parent / "web"


def last_env():
    fil = ROT / ".env"
    if not fil.exists():
        return
    for linje in fil.read_text(encoding="utf-8").splitlines():
        linje = linje.strip()
        if linje and not linje.startswith("#") and "=" in linje:
            nøkkel, verdi = linje.split("=", 1)
            os.environ.setdefault(nøkkel.strip(), verdi.strip().strip("\"'"))


last_env()

MODELL = os.environ.get("MODELL", "claude-sonnet-5-5")
MAX_ITERASJONER = int(os.environ.get("MAX_ITERASJONER", 12))
# Timer per uke som settes av til opplæring (20 % av en 40-timers uke).
UKETIMER = int(os.environ.get("UKETIMER", 8))
PORT = int(os.environ.get("PORT", 3001))
MAKS_RESULTAT_TEGN = 6000


def les_json(fil):
    return json.loads((DATA / fil).read_text(encoding="utf-8"))


konsulenter = les_json("konsulenter.json")
tilgjengelighet = les_json("tilgjengelighet.json")
prosjekthistorikk = les_json("prosjekthistorikk.json")
kurskatalog = les_json("kurs.json")
konsulent_fra_id = {k["id"]: k for k in konsulenter}
tilgjengelig_fra_id = {t["id"]: t for t in tilgjengelighet}
prosjekter_fra_id = {p["konsulent_id"]: p for p in prosjekthistorikk}


# Id-er er alltid k + tre sifre. Å validere mønsteret hindrer at noen ber om «../../.env».
def er_gyldig_id(id_):
    return isinstance(id_, str) and re.fullmatch(r"k\d{3}", id_) is not None


def les_cv(id_):
    if not er_gyldig_id(id_):
        raise ValueError(f'Ugyldig id «{id_}». Bruk formatet "k007".')
    fil = DATA / "cv" / f"{id_}.md"
    return fil.read_text(encoding="utf-8") if fil.exists() else None


# ---------------------------------------------------------------- verktøy

def sok_kompetanse(ferdighet=None, min_niva=1, maks_treff=15):
    if not isinstance(ferdighet, str) or not ferdighet.strip():
        raise ValueError('Mangler eller ugyldig «ferdighet». Oppgi en ferdighet å søke på, f.eks. {"ferdighet": "Terraform"}.')
    søk = ferdighet.strip().lower()
    treff = []
    for k in konsulenter:
        f = [x for x in k["kompetanse"] if søk in x["ferdighet"].lower() and x["nivå"] >= min_niva]
        if f:
            treff.append({"id": k["id"], "navn": k["navn"], "grad": k["grad"], "lokasjon": k["lokasjon"], "ferdigheter": f})
    treff.sort(key=lambda k: -max(x["nivå"] for x in k["ferdigheter"]))
    if not treff:
        return f"Ingen treff på «{ferdighet}» med nivå {min_niva} eller høyere. Prøv et annet ord eller lavere nivå."
    return {"antall_treff": len(treff), "viser": min(len(treff), maks_treff), "treff": treff[:maks_treff]}


def sjekk_tilgjengelighet(ider=None):
    if not isinstance(ider, list) or not ider:
        raise ValueError('Oppgi minst én id, f.eks. {"ider": ["k007", "k023"]}.')
    treff = [t for t in tilgjengelighet if t["id"] in ider]
    ukjente = [i for i in ider if i not in {t["id"] for t in treff}]
    return {"treff": treff, "ukjente_ider": ukjente} if ukjente else {"treff": treff}


def hent_cv(id=None):
    return les_cv(id) or f"Ingen CV for {id}. Bruk profilen og prosjekthistorikken i stedet."


def finn_prosjekthistorikk(id=None):
    if not er_gyldig_id(id):
        raise ValueError(f'Ugyldig id «{id}». Bruk formatet "k007".')
    rad = prosjekter_fra_id.get(id)
    return rad["prosjekter"] if rad and rad["prosjekter"] else f"Ingen prosjekthistorikk for {id}."


def finn_kurs(ferdighet=None, tema=None):
    søk = ferdighet.strip().lower() if isinstance(ferdighet, str) else ""
    treff = [
        {k: c[k] for k in ("id", "navn", "tema", "ferdighet", "fra_niva", "til_niva", "timer", "format")}
        for c in kurskatalog
        if søk in c["ferdighet"].lower() and (not tema or c["tema"] == tema)
    ]
    return treff[:20] or "Ingen kurs funnet. Prøv et annet ferdighetsnavn, eller la ferdighet stå tom for å se alle."


def gyldige_krav(krav):
    """Sjekker at krav er en liste med {ferdighet, min_niva}. Brukes både av verktøyet og av serveren."""
    if not isinstance(krav, list) or not krav:
        raise ValueError('Oppgi minst ett krav, f.eks. {"krav": [{"ferdighet": "Terraform", "min_niva": 3}]}.')
    ut = []
    for k in krav:
        if not (isinstance(k, dict) and isinstance(k.get("ferdighet"), str) and isinstance(k.get("min_niva"), int) and 1 <= k["min_niva"] <= 5):
            raise ValueError('Hvert krav må ha «ferdighet» (tekst) og «min_niva» (heltall 1–5).')
        ut.append({"ferdighet": k["ferdighet"].strip(), "min_niva": k["min_niva"]})
    return ut


def gap_beregn(id_, krav, start):
    """Gap mot kravene for én konsulent, med kurs som tetter gapet og en tidsplan.
    Kursene tas etter hverandre, UKETIMER timer i uka, fra og med start."""
    nivå = {f["ferdighet"].lower(): f["nivå"] for f in konsulent_fra_id[id_]["kompetanse"]}
    t = tilgjengelig_fra_id.get(id_)
    dato = start
    mangler, plan, uten_kurs = [], [], []
    for k in krav:
        nå = nivå.get(k["ferdighet"].lower(), 0)
        if nå >= k["min_niva"]:
            continue
        mangler.append({"ferdighet": k["ferdighet"], "krav": k["min_niva"], "naa": nå})
        trinn = max(nå, 1)
        while trinn < k["min_niva"]:
            passer = [c for c in kurskatalog if c["ferdighet"].lower() == k["ferdighet"].lower() and c["fra_niva"] <= trinn < c["til_niva"]]
            if not passer:
                uten_kurs.append(k["ferdighet"])
                break
            c = max(passer, key=lambda c: (c["til_niva"], -c["timer"]))  # lengste steg, så korteste kurs
            slutt = dato + timedelta(weeks=math.ceil(c["timer"] / UKETIMER))
            plan.append({
                "kurs_id": c["id"], "navn": c["navn"], "tema": c["tema"], "ferdighet": c["ferdighet"],
                "fra_niva": c["fra_niva"], "til_niva": c["til_niva"], "timer": c["timer"],
                "start": dato.isoformat(), "slutt": slutt.isoformat(),
            })
            dato, trinn = slutt, c["til_niva"]
    klar = dato.isoformat() if plan else None
    return {
        "id": id_, "navn": konsulent_fra_id[id_]["navn"], "mangler": mangler, "plan": plan, "uten_kurs": uten_kurs,
        "totalt_timer": sum(p["timer"] for p in plan), "klar_dato": klar,
        "ledig_fra": t["ledig_fra"] if t else None,
        "klar_for_ledig": (klar <= t["ledig_fra"]) if klar and t else None,
    }


def gap_analyse(ider=None, krav=None, start_dato=None):
    if not isinstance(ider, list) or not ider:
        raise ValueError('Oppgi minst én id, f.eks. {"ider": ["k007"]}.')
    krav = gyldige_krav(krav)
    try:
        start = date.fromisoformat(start_dato) if start_dato else date.today()
    except ValueError:
        raise ValueError('«start_dato» må være på formen ÅÅÅÅ-MM-DD.') from None
    kjente = [i for i in ider if i in konsulent_fra_id]
    ukjente = [i for i in ider if i not in konsulent_fra_id]
    svar = {"start": start.isoformat(), "uketimer": UKETIMER, "kandidater": [gap_beregn(i, krav, start) for i in kjente]}
    return {**svar, "ukjente_ider": ukjente} if ukjente else svar


# Beskrivelsene er det modellen leser, og de er de samme som i src/verktoy.js.
VERKTOY = [
    {
        "definisjon": {
            "name": "sok_kompetanse",
            "description": """Søker etter konsulenter som har en bestemt ferdighet i kompetanseprofilen sin.
Søket matcher på deler av ferdighetsnavnet uten å skille på store og små bokstaver, så «azure» treffer også «Azure DevOps» og «Azure Bicep».
Søk på én ferdighet om gangen. Trenger du to ferdigheter, gjør to søk og se hvem som går igjen.
Nivå er selvvurdert fra 1 (kjent med) til 5 (ekspert). Grad går fra A (junior) til E (mest senior).
Returnerer id, navn, grad, lokasjon og de matchende ferdighetene, sortert med høyest nivå først. Ikke hele profilen.
Sier ingenting om hvem som er ledig.""",
            "input_schema": {
                "type": "object",
                "properties": {
                    "ferdighet": {"type": "string", "description": "Ferdigheten du leter etter, f.eks. «Terraform» eller «React»."},
                    "min_niva": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Laveste nivå som teller. Standard er 1."},
                    "maks_treff": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Hvor mange treff du vil ha tilbake. Standard er 15."},
                },
                "required": ["ferdighet"],
            },
        },
        "kjør": sok_kompetanse,
    },
    {
        "definisjon": {
            "name": "sjekk_tilgjengelighet",
            "description": """Sjekker når konsulenter blir ledige. Gi en liste med id-er fra sok_kompetanse.
Returnerer for hver: nåværende oppdrag (kunde og sluttdato, eller null), dato de er ledige fra, og hvor mange prosent de er ledige.
Merk at noen bare er delvis ledige, og at enkelte har en kommentar som begrenser hva de kan ta.""",
            "input_schema": {
                "type": "object",
                "properties": {"ider": {"type": "array", "items": {"type": "string"}, "description": 'Konsulent-id-er, f.eks. ["k007", "k023"].'}},
                "required": ["ider"],
            },
        },
        "kjør": sjekk_tilgjengelighet,
    },
    {
        "definisjon": {
            "name": "hent_cv",
            "description": """Henter CV-sammendraget til én konsulent som markdown.
Ikke alle har CV. Mangler den, får du beskjed om det, og da må du klare deg med profilen og prosjekthistorikken.
CV-en kan være mer oppdatert, eller mindre, enn kompetanseprofilen. Si fra hvis de spriker.""",
            "input_schema": {
                "type": "object",
                "properties": {"id": {"type": "string", "description": 'Konsulent-id, f.eks. "k007".'}},
                "required": ["id"],
            },
        },
        "kjør": hent_cv,
    },
    {
        "definisjon": {
            "name": "finn_prosjekthistorikk",
            "description": """Henter tidligere prosjekter for én konsulent: kunde, bransje, år, rolle og teknologier.
Nyttig for å se om noen faktisk har brukt en teknologi i et oppdrag, ikke bare oppgitt den i profilen.
Juniorer har ofte ingen historikk ennå.""",
            "input_schema": {
                "type": "object",
                "properties": {"id": {"type": "string", "description": 'Konsulent-id, f.eks. "k007".'}},
                "required": ["id"],
            },
        },
        "kjør": finn_prosjekthistorikk,
    },
    {
        "definisjon": {
            "name": "finn_kurs",
            "description": """Søker i kurskatalogen. Katalogen har teknologikurs og et knippe Halloween-kurs (tema «halloween») som også gir ekte kompetanse.
Hvert kurs løfter en ferdighet fra et nivå til et høyere nivå, og har timer og format. Søket matcher på deler av ferdighetsnavnet.
La ferdighet stå tom for å bla i hele katalogen. Bruk tema for å begrense til «teknologi» eller «halloween».""",
            "input_schema": {
                "type": "object",
                "properties": {
                    "ferdighet": {"type": "string", "description": "Ferdighet å søke etter, f.eks. «Kubernetes»."},
                    "tema": {"type": "string", "enum": ["teknologi", "halloween"], "description": "Begrens til ett tema."},
                },
            },
        },
        "kjør": finn_kurs,
    },
    {
        "definisjon": {
            "name": "gap_analyse",
            "description": """Gapanalyse for konsulenter som nesten, men ikke helt, dekker kravene. Bruk den på de nærmeste kandidatene.
Du oppgir kravene som ferdighet og laveste nivå (1–5). Bruk ferdighetsnavn som i profilene, f.eks. «Terraform» eller «Azure».
Returnerer per konsulent hva som mangler (nåværende nivå mot krav), hvilke kurs fra katalogen som tetter gapet, en tidsplan med start og slutt per kurs, når de er klare, og om de er klare før de blir ledige.
Tidsplanen regner med at kursene tas etter hverandre, i et fast antall timer per uke.""",
            "input_schema": {
                "type": "object",
                "properties": {
                    "ider": {"type": "array", "items": {"type": "string"}, "description": 'Konsulent-id-er, f.eks. ["k007", "k023"].'},
                    "krav": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "ferdighet": {"type": "string", "description": "F.eks. «Terraform»."},
                                "min_niva": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Laveste nivå som kreves."},
                            },
                            "required": ["ferdighet", "min_niva"],
                        },
                        "description": "Ferdighetene behovet krever.",
                    },
                    "start_dato": {"type": "string", "description": "Når opplæringen starter, ÅÅÅÅ-MM-DD. Standard er i dag."},
                },
                "required": ["ider", "krav"],
            },
        },
        "kjør": gap_analyse,
    },
]
VERKTOY_ETTER_NAVN = {v["definisjon"]["name"]: v for v in VERKTOY}

SYSTEM = """Du er bemanningsagenten i et konsulentselskap med kontorer i Oslo, Bergen, Trondheim og Stavanger.
Du får et behov i naturlig språk og skal finne de beste kandidatene.

- Bryt behovet ned i konkrete søk (ferdigheter, tidspunkt, grad, lokasjon) før du slår opp.
- Gjør flere oppslag og sjekk det du kan, ikke stol på ett søk.
- Svar med en rangert liste der hver kandidat har en kort begrunnelse.
- Finner du ingen perfekt match, foreslå nest beste og si tydelig hva som mangler.
- Si fra hvis du ikke har verktøy til å sjekke noe som betyr noe for svaret.
- Grad går fra A (junior) til E (mest senior). Svar på norsk.
- Finnes det ingen kandidat som dekker alle kravene, ta med de som er nærmest og bruk gap_analyse på dem. Bruk finn_kurs hvis du vil se hva katalogen har.

- Hvis noen av de beste kandidatene ikke dekker alle kravene, kall gap_analyse for dem før du svarer.

Brukeren bygger et team ved å velge kandidater fra svarene dine, og kan gjøre flere søk. Teamet står i [hakeparenteser] etter spørsmålet når det finnes. Foreslår du nye kandidater, tenk på hva som mangler i teamet, og ikke foreslå noen som allerede er med.

Du husker hele samtalen. Brukeren kan stille oppfølgingsspørsmål om kandidatene du allerede har funnet, f.eks. «hva med Lucas?» eller «hvilke kurs trenger hun?». Svar da ut fra det du allerede vet, og slå bare opp på nytt hvis du må. Gjelder spørsmålet bestemte kandidater som bør vises som kort (f.eks. for å se opplæringsplanen deres), tar du dem med i «kandidater». Ellers lar du «kandidater» være en tom liste, så beholder brukeren kortene fra forrige svar.

Stil: kort og gøy, med Halloween-stemning. Ikke forklar fremgangsmåten din og ikke gjenta det kortene allerede viser.

Svaret ditt er KUN en kodeblokk på formen nedenfor, uten tekst før eller etter. Ved et nytt søk tar du med de 3 beste kandidatene i rangert rekkefølge (færre hvis færre passer).

```json
{"oppsummering": "Tre sjeler overlevde søket. Ingrid er den som ikke blir borte ved midnatt.", "usikkerhet": null, "krav": [{"ferdighet": "Terraform", "min_niva": 3}], "kandidater": [{"id": "k007", "begrunnelse": "Terraform-trollmann, ledig før fullmåne.", "tidspunkt": "ja", "avvik": null}]}
```

- «oppsummering» er maks to korte setninger i ren tekst uten markdown, gjerne med en spøk. Ikke list opp kandidatene. Ved et oppfølgingsspørsmål er den svaret ditt, og kan være opptil fire korte setninger.
- «krav» er ferdighetene behovet krever, med ferdighetsnavn slik de står i profilene og laveste nivå (1–5): «kan» ca. 3, «senior» eller «høyt nivå» ca. 4, «ekspert» 5. Serveren bruker kravene til å regne ut gap og opplæringsplan for hver kandidat.
- «begrunnelse» er én kort setning på maks 15 ord, gjerne morsom.
- «tidspunkt» sier om kandidaten er tilgjengelig for det som etterspørres: "ja", "delvis", "nei" eller "ukjent".
- «usikkerhet» er det du ikke vet eller ikke har verktøy til å sjekke, når det betyr noe for svaret (f.eks. referanser, lønn eller kapasitet utover det dataene viser). Én kort setning, ellers null. Ikke fyll den med noe bare for å fylle den.
- «avvik» er en kort tekst hvis profil og CV, eller kompetanse og prosjekthistorikk, sier ulike ting om kandidaten. At CV mangler er ikke et avvik. Ellers null."""


# ---------------------------------------------------------------- samtaleminne

# Hver nettleserfane har en sesjons-id og får sin egen samtale, inkludert verktøykall og resultater.
# Samtalen huskes til brukeren skriver «Obliviate». Sesjonene ligger bare i minnet, så de forsvinner
# når serveren stoppes. De eldste kastes hvis det blir mange.
MAKS_SESJONER = 50
# Over dette antallet input-tokens i siste forespørsel ber vi brukeren om å starte på nytt.
HUKOMMELSE_ADVARSEL_TOKENS = 120_000

sesjoner = OrderedDict()
opptatte = set()
sesjonslås = threading.Lock()


def hent_sesjon(id_):
    with sesjonslås:
        samtale = sesjoner.setdefault(id_, [])
        sesjoner.move_to_end(id_)
        while len(sesjoner) > MAKS_SESJONER:
            sesjoner.popitem(last=False)
        return samtale


def glem_sesjon(id_):
    with sesjonslås:
        sesjoner.pop(id_, None)


def er_obliviate(tekst):
    return re.fullmatch(r"obliviate[\s!.]*", tekst.strip().lower()) is not None


MAKS_TEAM = 20


def team_notat(ider):
    """Teamet brukeren har bygget, som en kort tekst agenten får sammen med spørsmålet.
    Id-ene sjekkes mot dataene, så bare ekte konsulenter kommer med."""
    if not isinstance(ider, list):
        return ""
    medlemmer = [konsulent_fra_id[i] for i in dict.fromkeys(ider[:MAKS_TEAM]) if isinstance(i, str) and i in konsulent_fra_id]
    if not medlemmer:
        return ""
    liste = "; ".join(f"{m['navn']} ({m['id']}, {m['rolle']}, grad {m['grad']}, {m['lokasjon']})" for m in medlemmer)
    return f"\n\n[Teamet brukeren har bygget så langt: {liste}. Bruk det hvis spørsmålet gjelder teamet, f.eks. hva som mangler eller hvem som bør legges til.]"


# ---------------------------------------------------------------- agentløkka

def kjor_verktoy(kall):
    """Kjører ett verktøykall. Feil går tilbake til modellen som et feilresultat."""
    v = VERKTOY_ETTER_NAVN.get(kall.name)
    if not v:
        return f"Ukjent verktøy «{kall.name}». Gyldige: {', '.join(VERKTOY_ETTER_NAVN)}", True
    try:
        resultat = v["kjør"](**(kall.input or {}))
        return (resultat if isinstance(resultat, str) else json.dumps(resultat, ensure_ascii=False, indent=2)), False
    except (ValueError, TypeError) as e:
        return str(e), True


def kjor_agent(messages, ved):
    """Kjører løkka videre på samtalen. `messages` endres på stedet og slutter med brukerens nyeste melding.
    Returnerer antall input-tokens i siste forespørsel, som sier hvor full hukommelsen er."""
    klient = anthropic.Anthropic()
    verktoy = [v["definisjon"] for v in VERKTOY]
    tokens = 0

    for _ in range(MAX_ITERASJONER):
        svar = klient.messages.create(model=MODELL, max_tokens=16000, system=SYSTEM, tools=verktoy, messages=messages)
        tokens = svar.usage.input_tokens
        messages.append({"role": "assistant", "content": svar.content})

        for blokk in svar.content:
            if blokk.type == "text" and blokk.text.strip():
                ved({"type": "tekst", "tekst": blokk.text, "mellomsteg": svar.stop_reason == "tool_use"})

        if svar.stop_reason != "tool_use":
            # end_turn, refusal og max_tokens avslutter alle løkka.
            ved({"type": "ferdig", "stopp": svar.stop_reason})
            return tokens

        # Modellen kan be om flere verktøy samtidig. Alle resultatene må tilbake i én melding.
        resultater = []
        for k in (b for b in svar.content if b.type == "tool_use"):
            ved({"type": "verktoy_kall", "id": k.id, "navn": k.name, "input": k.input})
            tekst, feil = kjor_verktoy(k)
            ved({"type": "verktoy_resultat", "id": k.id, "ok": not feil, "tegn": len(tekst), "resultat": tekst})
            resultat = {"type": "tool_result", "tool_use_id": k.id, "content": tekst}
            if feil:
                resultat["is_error"] = True
            resultater.append(resultat)
        messages.append({"role": "user", "content": resultater})

    ved({"type": "ferdig", "stopp": "maks_iterasjoner"})
    return tokens


# ---------------------------------------------------------------- svar til frontenden

def tolk_svar(tekst, søkt):
    """Henter den siste json-blokken ut av svaret og beriker kandidatene med data fra filene.
    `søkt` er ferdighetene agenten søkte på i dette svaret, med laveste nivå i søket."""
    blokker = list(re.finditer(r"```json\s*([\s\S]*?)```", tekst))
    siste = blokker[-1] if blokker else None
    rangert, krav, oppsummering, usikkerhet = [], [], None, None
    if siste:
        try:
            svar = json.loads(siste.group(1))
            rangert = svar.get("kandidater", [])
            oppsummering = svar.get("oppsummering")
            usikkerhet = svar.get("usikkerhet") if isinstance(svar.get("usikkerhet"), str) and svar["usikkerhet"].strip() else None
            krav = gyldige_krav(svar.get("krav"))
        except (ValueError, AttributeError):
            pass  # Ugyldig JSON: vis det vi har. Uten gyldige krav blir det ingen gapanalyse.
    sammendrag = oppsummering if isinstance(oppsummering, str) else (tekst.replace(siste.group(0), "") if siste else tekst)
    sammendrag = sammendrag.strip()
    if not krav and rangert and søkt:
        # Glemte modellen å oppgi krav, bruker vi det den faktisk søkte på, så gapanalysen ikke uteblir.
        krav = [{"ferdighet": f, "min_niva": max(n, 3)} for f, n in søkt.items()]

    kandidater = []
    for k in rangert:
        profil = konsulent_fra_id.get(k.get("id")) if isinstance(k, dict) else None
        if not profil:
            continue
        # Gapet regnes ut her og ikke av modellen, så tall og datoer alltid stemmer med dataene.
        gap = gap_beregn(profil["id"], krav, date.today()) if krav else None
        kandidater.append({
            "gap": gap if gap and gap["mangler"] else None,
            "rang": len(kandidater) + 1,
            "id": profil["id"],
            "navn": profil["navn"],
            "grad": profil["grad"],
            "rolle": profil["rolle"],
            "lokasjon": profil["lokasjon"],
            "matchendeFerdigheter": [f for f in profil["kompetanse"] if any(s.lower() in f["ferdighet"].lower() for s in søkt)],
            "tilgjengelighet": tilgjengelig_fra_id.get(profil["id"]),
            "tidspunkt": k.get("tidspunkt") if k.get("tidspunkt") in ("ja", "delvis", "nei", "ukjent") else "ukjent",
            "begrunnelse": str(k.get("begrunnelse") or ""),
            "avvik": str(k["avvik"]) if k.get("avvik") else None,
            "harCv": les_cv(profil["id"]) is not None,
        })
    return sammendrag, kandidater, usikkerhet


def usikkerhetsnotater(modellens, kandidater, nytt_sok):
    """Det agenten ikke vet, som korte notater under svaret. Det som kan leses av dataene
    (ingen ledige, manglende CV) legges til her og ikke overlatt til modellen, så grensene alltid vises."""
    notater = [modellens] if modellens else []
    if nytt_sok and kandidater:
        if not any(k["tidspunkt"] == "ja" for k in kandidater):
            notater.append("Ingen av kandidatene er fullt ledige for det du ba om.")
        uten_cv = [k["navn"] for k in kandidater if not k["harCv"]]
        if uten_cv:
            notater.append(f"Mangler CV for {', '.join(uten_cv)}. Vurderingen bygger på profil og prosjekthistorikk.")
    return notater


MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".jpg": "image/jpeg",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Stille: verktøykallene er det som er interessant.

    def json(self, status, data):
        kropp = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(kropp)))
        self.end_headers()
        self.wfile.write(kropp)

    def do_GET(self):
        sti = self.path.split("?")[0]
        m = re.fullmatch(r"/api/konsulenter/([^/]+)", sti)
        if m:
            return self.konsulent_detalj(m.group(1))
        if sti == "/api/kurs":
            return self.json(200, kurskatalog)
        if sti.startswith("/api/"):
            return self.json(404, {"feil": "Ikke funnet."})
        self.statisk(sti)

    def do_POST(self):
        if self.path.split("?")[0] != "/api/match":
            return self.json(404, {"feil": "Ikke funnet."})
        lengde = int(self.headers.get("Content-Length") or 0)
        try:
            kropp = json.loads(self.rfile.read(min(lengde, 10_000)) or b"{}")
        except ValueError:
            kropp = {}
        oppgave = kropp.get("oppgave", "") if isinstance(kropp, dict) else ""
        oppgave = oppgave.strip() if isinstance(oppgave, str) else ""
        sesjon = kropp.get("sesjon") if isinstance(kropp, dict) else None
        if not oppgave or len(oppgave) > 1000:
            return self.json(400, {"feil": "Oppgi et behov på mellom 1 og 1000 tegn."})
        if not (isinstance(sesjon, str) and re.fullmatch(r"[\w-]{1,64}", sesjon)):
            return self.json(400, {"feil": "Mangler gyldig sesjons-id."})
        if sesjon in opptatte:
            return self.json(409, {"feil": "Orakelet jobber fortsatt med forrige spørsmål."})

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.frakoblet = False

        def send(h):
            if self.frakoblet:
                return
            try:
                self.wfile.write((json.dumps(h, ensure_ascii=False) + "\n").encode("utf-8"))
                self.wfile.flush()
            except OSError:
                self.frakoblet = True  # Nettleseren ble lukket.

        # «Obliviate» glemmer hele samtalen. Det går ikke via modellen.
        if er_obliviate(oppgave):
            glem_sesjon(sesjon)
            send({"type": "glemt"})
            return

        søkt, svar_tekst, stopp = {}, [], [None]

        def ved(h):
            if h["type"] == "tekst":
                if h["mellomsteg"]:
                    send({"type": "tanke", "tekst": h["tekst"]})
                else:
                    svar_tekst.append(h["tekst"])
            elif h["type"] == "verktoy_kall":
                if h["navn"] == "sok_kompetanse" and isinstance(h["input"].get("ferdighet"), str):
                    nivå = h["input"].get("min_niva")
                    søkt[h["input"]["ferdighet"].strip()] = nivå if isinstance(nivå, int) else 1
                send(h)
            elif h["type"] == "verktoy_resultat":
                send({**h, "resultat": h["resultat"][:MAKS_RESULTAT_TEGN]})
            elif h["type"] == "ferdig":
                stopp[0] = h["stopp"]

        samtale = hent_sesjon(sesjon)
        før = len(samtale)
        opptatte.add(sesjon)
        notat = team_notat(kropp.get("team"))
        if not notat and kropp.get("team_nullstilt") is True:
            # Teamet ble nylig lagret i repositoriet. Uten denne beskjeden tror agenten at de gamle medlemmene fortsatt er med.
            notat = "\n\n[Brukeren har lagret det forrige teamet og begynt på et nytt, tomt team.]"
        samtale.append({"role": "user", "content": oppgave + notat})
        try:
            tokens = kjor_agent(samtale, ved)
            sammendrag, kandidater, usikkerhet = tolk_svar("\n".join(svar_tekst), søkt)
            send({
                "type": "resultat", "stopp": stopp[0], "sammendrag": sammendrag, "kandidater": kandidater,
                "hukommelse_full": tokens > HUKOMMELSE_ADVARSEL_TOKENS,
                # Et nytt søk erstatter kortene. Et oppfølgingsspørsmål oppdaterer dem på plass.
                "nytt_sok": bool(søkt),
                "usikkerhet": usikkerhetsnotater(usikkerhet, kandidater, bool(søkt)),
            })
        except anthropic.APIError as e:
            del samtale[før:]  # Ikke la en halvferdig runde bli med i minnet.
            print("API-feil:", e)
            send({"type": "feil", "melding": getattr(e, "message", None) or "Feil fra Anthropic-API-et."})
        except Exception as e:  # noqa: BLE001
            del samtale[før:]
            print("Feil:", repr(e))
            send({"type": "feil", "melding": "Intern feil i serveren."})
        finally:
            opptatte.discard(sesjon)

    def konsulent_detalj(self, id_):
        if not er_gyldig_id(id_) or id_ not in konsulent_fra_id:
            return self.json(404, {"feil": f"Ukjent konsulent «{id_}»."})
        self.json(200, {
            "konsulent": konsulent_fra_id[id_],
            "tilgjengelighet": tilgjengelig_fra_id.get(id_),
            "prosjekter": prosjekter_fra_id.get(id_, {}).get("prosjekter", []),
            "cv": les_cv(id_),
        })

    def statisk(self, sti):
        fil = (WEB / ("index.html" if sti == "/" else sti.lstrip("/"))).resolve()
        if not fil.is_relative_to(WEB):  # stopper «..»-stier
            return self.json(404, {"feil": "Ikke funnet."})
        if not fil.is_file():
            return self.json(404, {"feil": "Ikke funnet."})
        kropp = fil.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(fil.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(kropp)))
        self.end_headers()
        self.wfile.write(kropp)


if __name__ == "__main__":
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("Mangler ANTHROPIC_API_KEY. Sett den i miljøet eller i .env.")
    print(f"🔮 Seansen (Python) lytter på http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
