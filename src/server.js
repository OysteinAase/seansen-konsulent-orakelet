// HTTP-API for frontenden. API-nøkkelen blir på serveren.
//   POST /api/match            streamer agentens arbeid som NDJSON (én JSON-hendelse per linje)
//   GET  /api/konsulenter/:id  profil, tilgjengelighet, prosjekter og CV til én konsulent
// I tillegg serveres frontend/dist hvis den er bygget.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { system, verktøy, konsulenter, tilgjengelighet, prosjekthistorikk, erGyldigId, lesCv } from './verktoy.js';

try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Mangler ANTHROPIC_API_KEY. Kopier .env.example til .env og lim inn nøkkelen.');
  process.exit(1);
}

// Importeres etter at .env er lest, siden klienten leser nøkkelen når modulen lastes.
const { kjørAgent } = await import('./agent.js');

const PORT = Number(process.env.PORT ?? 3001);
const DIST = path.join(import.meta.dirname, '..', 'frontend', 'dist');
const MAKS_RESULTAT_TEGN = 6000;

// Frontenden trenger en rangert liste med strukturerte felter, ikke bare fritekst.
// Modellen oppgir id, begrunnelse og avvik. Resten slår serveren opp i dataene.
const webSystem = `${system}

Avslutt alltid svaret med en kodeblokk på formen nedenfor, med de 3 til 5 beste kandidatene i rangert rekkefølge. Skriv en kort oppsummering på maks tre setninger før kodeblokken, i ren tekst uten markdown og uten å liste opp kandidatene. Kortene i grensesnittet viser kandidatene.

\`\`\`json
{"kandidater": [{"id": "k007", "begrunnelse": "Kort begrunnelse for hvorfor kandidaten passer.", "tidspunkt": "ja", "avvik": null}]}
\`\`\`

- «tidspunkt» sier om kandidaten er tilgjengelig for det som etterspørres: "ja", "delvis", "nei" eller "ukjent".
- «avvik» er en kort tekst hvis profil og CV, eller kompetanse og prosjekthistorikk, sier ulike ting om kandidaten. At CV mangler er ikke et avvik. Ellers null.`;

const byId = (liste, nøkkel = 'id') => new Map(liste.map((r) => [r[nøkkel], r]));
const konsulentFraId = byId(konsulenter);
const tilgjengeligFraId = byId(tilgjengelighet);
const prosjekterFraId = byId(prosjekthistorikk, 'konsulent_id');

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && pathname === '/api/match') return await match(req, res);
    const detalj = pathname.match(/^\/api\/konsulenter\/([^/]+)$/);
    if (req.method === 'GET' && detalj) return konsulentDetalj(res, detalj[1]);
    if (req.method === 'GET' && !pathname.startsWith('/api/')) return statisk(res, pathname);
    json(res, 404, { feil: 'Ikke funnet.' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { feil: 'Intern feil.' });
    else res.end();
  }
});

async function match(req, res) {
  const kropp = await lesKropp(req);
  const oppgave = typeof kropp?.oppgave === 'string' ? kropp.oppgave.trim() : '';
  if (!oppgave || oppgave.length > 1000) {
    return json(res, 400, { feil: 'Oppgi et behov på mellom 1 og 1000 tegn.' });
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });
  const send = (h) => res.writableEnded || res.write(JSON.stringify(h) + '\n');

  const søkt = new Set();
  let svarTekst = '';
  let stopp = null;

  const ved = (h) => {
    if (h.type === 'tekst') {
      if (h.mellomsteg) send({ type: 'tanke', tekst: h.tekst });
      else svarTekst += `${h.tekst}\n`;
    } else if (h.type === 'verktoy_kall') {
      if (h.navn === 'sok_kompetanse' && typeof h.input?.ferdighet === 'string') søkt.add(h.input.ferdighet.toLowerCase());
      send(h);
    } else if (h.type === 'verktoy_resultat') {
      send({ ...h, resultat: h.resultat.slice(0, MAKS_RESULTAT_TEGN) });
    } else if (h.type === 'ferdig') {
      stopp = h.stopp;
    }
  };

  try {
    await kjørAgent({ system: webSystem, oppgave, verktøy, ved });
    const { sammendrag, kandidater } = tolkSvar(svarTekst, søkt);
    send({ type: 'resultat', stopp, sammendrag, kandidater });
  } catch (e) {
    console.error(e);
    send({ type: 'feil', melding: e.message });
  }
  res.end();
}

// Henter den siste json-blokken ut av svaret og beriker kandidatene med data fra filene.
function tolkSvar(tekst, søkt) {
  const blokker = [...tekst.matchAll(/```json\s*([\s\S]*?)```/g)];
  const siste = blokker.at(-1);
  let rangert = [];
  if (siste) {
    try {
      rangert = JSON.parse(siste[1]).kandidater ?? [];
    } catch {
      // Ugyldig JSON: vis oppsummeringen uten kort.
    }
  }
  const sammendrag = (siste ? tekst.replace(siste[0], '') : tekst).trim();

  const kandidater = rangert
    .filter((k) => konsulentFraId.has(k?.id))
    .map((k, i) => {
      const profil = konsulentFraId.get(k.id);
      return {
        rang: i + 1,
        id: k.id,
        navn: profil.navn,
        grad: profil.grad,
        rolle: profil.rolle,
        lokasjon: profil.lokasjon,
        matchendeFerdigheter: profil.kompetanse.filter((f) => [...søkt].some((s) => f.ferdighet.toLowerCase().includes(s))),
        tilgjengelighet: tilgjengeligFraId.get(k.id) ?? null,
        tidspunkt: ['ja', 'delvis', 'nei', 'ukjent'].includes(k.tidspunkt) ? k.tidspunkt : 'ukjent',
        begrunnelse: String(k.begrunnelse ?? ''),
        avvik: k.avvik ? String(k.avvik) : null,
        harCv: lesCv(k.id) !== null,
      };
    });
  return { sammendrag, kandidater };
}

function konsulentDetalj(res, id) {
  if (!erGyldigId(id) || !konsulentFraId.has(id)) return json(res, 404, { feil: `Ukjent konsulent «${id}».` });
  json(res, 200, {
    konsulent: konsulentFraId.get(id),
    tilgjengelighet: tilgjengeligFraId.get(id) ?? null,
    prosjekter: prosjekterFraId.get(id)?.prosjekter ?? [],
    cv: lesCv(id),
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function statisk(res, pathname) {
  const fil = path.join(DIST, path.normalize(pathname === '/' ? 'index.html' : pathname));
  // normalize kan gi «..»-stier, så bli innenfor dist.
  if (!fil.startsWith(DIST) || !fs.existsSync(fil) || !fs.statSync(fil).isFile()) {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) {
      return json(res, 404, { feil: 'Frontend er ikke bygget. Kjør «npm run bygg», eller «npm run frontend» for utvikling.' });
    }
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    return res.end(fs.readFileSync(path.join(DIST, 'index.html')));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fil)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(fil));
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function lesKropp(req) {
  let tekst = '';
  for await (const del of req) {
    tekst += del;
    if (tekst.length > 10_000) return null;
  }
  try {
    return JSON.parse(tekst);
  } catch {
    return null;
  }
}

server.listen(PORT, () => console.log(`🔮 Seansen lytter på http://localhost:${PORT}`));
