// Frontenden uten byggesteg. Samme oppførsel som React-versjonen i frontend/.
// Det første forslaget er starten på demoscenarioet (docs/video-manus.md). De to andre er selvstendige søk.
const EKSEMPLER = [
  'Vi trenger en Kubernetes-ekspert som også kan Terraform på høyt nivå, ledig fra november.',
  'Vi trenger en senior React-utvikler i Bergen fra desember, helst med erfaring fra finans.',
  'Hvem kan lede et dataplattformprosjekt i Trondheim, og er ledig før nyttår?',
];

// Etter første spørsmål byttes forslagene ut med neste steg i scenarioet.
const FØLGEFORSLAG = [
  { tekst: 'Nå trenger vi også en som kan React.' },
  { tekst: 'Hva mangler teamet vårt hvis vi skal levere fra sky til frontend?' },
  { tekst: 'Wingardium Leviosa', etikett: '🪄 Wingardium Leviosa' },
];

const STOPPMELDING = {
  refusal: 'Modellen avslo å svare.',
  max_tokens: 'Svaret ble kuttet.',
  maks_iterasjoner: 'Agenten brukte opp antall tillatte runder.',
};

const TIDSPUNKT = {
  ja: ['Ledig', 'gronn'],
  delvis: ['Delvis tilgjengelig', 'gul'],
  nei: ['Ikke ledig', 'rod'],
  ukjent: ['Ukjent', 'ukjent'],
};

// Det agenten gjør akkurat nå, i klartekst. Vises som en liten tenkeboble i samtalen.
const VERKTØYTEKST = {
  sok_kompetanse: 'Søker i kompetanseprofilene',
  sjekk_tilgjengelighet: 'Sjekker hvem som er ledige',
  hent_cv: 'Leser CV',
  finn_prosjekthistorikk: 'Graver i prosjekthistorikken',
  finn_kurs: 'Blar i kurskatalogen',
  gap_analyse: 'Regner ut gap og opplæringsplan',
};

// Gradene har navn i rosteret: A er nybegynner og E er legende.
const RANG = { A: 'Apprentice', B: 'Adept', C: 'Veteran', D: 'Master', E: 'Legend' };
const portrett = (id) => `/assets/portraits/ai/${encodeURIComponent(id)}.jpg`;

const $ = (id) => document.getElementById(id);
const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let jobber = false;
let formelPågår = false; // en formel (Wingardium Leviosa) spilles av og blokkerer nye spørsmål
let teamNullstilt = false; // sendes til agenten ved neste spørsmål etter at teamet er lagret

// Serveren husker samtalen per sesjon. «Obliviate» gir en ny sesjon og en ren start.
const nySesjon = () => globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let sesjon = nySesjon();

// ---------------------------------------------------------------- oppstart

function visForslag(modus) {
  const liste = modus === 'følge' ? FØLGEFORSLAG : EKSEMPLER.map((tekst) => ({ tekst }));
  $('eksempler').dataset.modus = modus;
  $('eksempler').innerHTML = liste
    .map((f) => `<button type="button" class="chip" data-tekst="${e(f.tekst)}"${jobber ? ' disabled' : ''}>${e(f.etikett ?? f.tekst)}</button>`)
    .join('');
}
visForslag('start');
$('eksempler').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (chip) spør(chip.dataset.tekst);
});
$('skjema').addEventListener('submit', (ev) => {
  ev.preventDefault();
  spør($('oppgave').value);
});
$('oppgave').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) spør($('oppgave').value);
});
$('glem').addEventListener('click', () => spør('Obliviate'));
$('mobilmeny').addEventListener('click', () => $('sidemeny').classList.toggle('apen'));
// Forsiden viser en tilfeldig sjel hver gang, som i rosteret.
$('portrett-forside').src = portrett(`k${String(1 + Math.floor(Math.random() * 80)).padStart(3, '0')}`);
// Å klikke på et kort legger kandidaten i teamet. Profilen åpnes med egen knapp. Planen inni kortet kan markeres og leses uten å velge.
const velgKort = (ev) => {
  const kort = ev.target.closest('.kandidat');
  if (!kort || ev.target.closest('.gap')) return;
  const k = kandidater.find((x) => x.id === kort.dataset.id);
  if (ev.target.closest('.profil-knapp')) åpneDetalj(k);
  else leggTilTeam(k);
};
$('kandidater').addEventListener('click', velgKort);
$('kandidater').addEventListener('keydown', (ev) => ev.key === 'Enter' && ev.target.classList.contains('kandidat') && velgKort(ev));

let kandidater = [];

// ---------------------------------------------------------------- mitt team

// Teamet bygges opp over flere søk og følger med til agenten. «Obliviate» tømmer det.
let team = [];

function leggTilTeam(k) {
  if (team.some((m) => m.id === k.id)) {
    const el = $('team').querySelector(`[data-id="${CSS.escape(k.id)}"]`);
    el?.classList.remove('blink');
    void el?.offsetWidth;
    el?.classList.add('blink'); // allerede med: vis hvor de står
    return;
  }
  team.push(k);
  tegnTeam();
}

function tegnTeam() {
  $('team-antall').textContent = team.length ? `${team.length} ${team.length === 1 ? 'medlem' : 'medlemmer'}` : '';
  $('team').innerHTML = team.length
    ? team.map(medlem).join('')
    : '<p class="tom">Klikk på en kandidat til høyre for å legge dem til i teamet.</p>';
  document.querySelectorAll('.kandidat').forEach((el) => el.classList.toggle('i-team', team.some((m) => m.id === el.dataset.id)));
}

function medlem(k) {
  const a = k.tilgjengelighet;
  return `<div class="medlem" role="button" tabindex="0" data-id="${e(k.id)}" title="Åpne profilen">
    <img class="medlem-bilde" src="${portrett(k.id)}" alt="">
    <div class="medlem-tekst"><strong>${e(k.navn)}</strong>
      <span class="meta">${e(k.rolle)} · grad ${e(k.grad)} · ${e(k.lokasjon)}</span>
      ${a ? `<span class="meta">ledig fra ${e(dato(a.ledig_fra))} · ${a.ledig_prosent} %</span>` : ''}</div>
    <button type="button" class="fjern" aria-label="Fjern ${e(k.navn)} fra teamet">✕</button>
  </div>`;
}

$('team').addEventListener('click', (ev) => {
  const rad = ev.target.closest('.medlem');
  if (!rad) return;
  if (ev.target.closest('.fjern')) {
    team = team.filter((m) => m.id !== rad.dataset.id);
    tegnTeam();
  } else {
    åpneDetalj(team.find((m) => m.id === rad.dataset.id));
  }
});
$('team').addEventListener('keydown', (ev) => ev.key === 'Enter' && ev.target.classList.contains('medlem') && ev.target.click());
tegnTeam();

// Samme oppsett som når det første spørsmålet stilles: chatten og teamet er synlige, og hint og plassholder passer til en samtale.
function åpneArbeidsflate() {
  $('rutenett').hidden = false;
  $('hero').classList.add('kompakt');
  if ($('eksempler').dataset.modus !== 'følge') visForslag('følge');
  $('eksempler').hidden = false;
  $('glem').hidden = false;
  $('minnehint').textContent = 'Orakelet husker samtalen og teamet. Søk videre, still oppfølgingsspørsmål, eller skriv «Obliviate» for å glemme alt.';
  $('minnehint').hidden = false;
  $('oppgave').placeholder = 'Søk etter flere, eller spør om teamet …';
}

// ---------------------------------------------------------------- team repository

// Ferdige team ligger i nettleserens lokale lagring, så de overlever at siden lastes på nytt.
// «Obliviate» glemmer samtalen og det pågående teamet, men rører ikke repositoriet.
const REPO_NØKKEL = 'seansen.teamrepository';
const MAKS_LAGREDE_TEAM = 50;

function lesRepo() {
  try {
    const lagret = JSON.parse(localStorage.getItem(REPO_NØKKEL));
    return Array.isArray(lagret) ? lagret : [];
  } catch {
    return []; // tom, ødelagt eller blokkert lagring
  }
}

let repo = lesRepo();

function skrivRepo() {
  try {
    localStorage.setItem(REPO_NØKKEL, JSON.stringify(repo));
  } catch {
    // Lagring er full eller blokkert. Teamene finnes videre i minnet så lenge siden er åpen.
  }
}

// Bare det som trengs for å vise medlemmet igjen, ikke hele kandidatsvaret.
const tilLagring = (k) => ({
  id: k.id, navn: k.navn, rolle: k.rolle, grad: k.grad, lokasjon: k.lokasjon, tilgjengelighet: k.tilgjengelighet ?? null,
  matchendeFerdigheter: k.matchendeFerdigheter ?? [], begrunnelse: k.begrunnelse ?? '', tidspunkt: k.tidspunkt ?? 'ukjent', avvik: null, gap: null, rang: 0,
});

function lagreTeamIRepo() {
  const nr = repo.reduce((størst, t) => Math.max(størst, t.nr), 0) + 1;
  const lagret = { nr, navn: `Team ${nr}`, dato: new Date().toISOString(), medlemmer: team.map(tilLagring) };
  repo = [lagret, ...repo].slice(0, MAKS_LAGREDE_TEAM);
  skrivRepo();
  tegnRepo();
  return lagret;
}

function tegnRepo() {
  $('repo-teller').textContent = repo.length || '';
  $('repo-antall').textContent = repo.length ? `${repo.length} team lagret` : '';
  $('repo-liste').innerHTML = repo.length
    ? repo.map(repoKort).join('')
    : '<p class="tom">Ingen team er lagret ennå. Bygg et team, og skriv «Wingardium Leviosa» i chatten for å løfte det hit.</p>';
}

function repoKort(t) {
  const tidspunkt = new Date(t.dato).toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<article class="repokort" data-nr="${e(t.nr)}">
    <div class="rad"><span class="soul-class">${e(t.navn)}</span><span class="meta">${e(tidspunkt)} · ${t.medlemmer.length} ${t.medlemmer.length === 1 ? 'medlem' : 'medlemmer'}</span></div>
    <div class="repo-medlemmer">${t.medlemmer
      .map((m) => `<button type="button" class="repo-medlem" data-id="${e(m.id)}"><img src="${portrett(m.id)}" alt="" loading="lazy"><span><strong>${e(m.navn)}</strong><small>${e(m.rolle)} · grad ${e(m.grad)}</small></span></button>`)
      .join('')}</div>
    <div class="repo-handling"><button type="button" class="ghost-button hent">Hent tilbake i teamet</button><button type="button" class="ghost-button slett">Slett</button></div>
  </article>`;
}

$('repo-liste').addEventListener('click', (ev) => {
  const kort = ev.target.closest('.repokort');
  if (!kort) return;
  const t = repo.find((x) => String(x.nr) === kort.dataset.nr);
  if (!t) return;
  const medlemKnapp = ev.target.closest('.repo-medlem');
  if (medlemKnapp) {
    åpneDetalj(t.medlemmer.find((m) => m.id === medlemKnapp.dataset.id));
  } else if (ev.target.closest('.slett')) {
    if (!window.confirm(`Slette «${t.navn}» fra repositoriet?`)) return;
    repo = repo.filter((x) => x !== t);
    skrivRepo();
    tegnRepo();
  } else if (ev.target.closest('.hent')) {
    // Legges til det pågående teamet, så ingenting som allerede er valgt forsvinner.
    for (const m of t.medlemmer) if (!team.some((x) => x.id === m.id)) team.push(m);
    tegnTeam();
    åpneArbeidsflate();
    byttFane('orakel');
  }
});
tegnRepo();

// ---------------------------------------------------------------- Wingardium Leviosa

// Teamet løftes, svever med et lite vingel og flyr så inn i Team Repository i sidemenyen.
// Teamet lagres først, så ingenting går tapt selv om animasjonen avbrytes.
async function leviosa() {
  formelPågår = true;
  $('oppgave').value = '';
  $('feil').hidden = true;
  try {
    if (!team.length) {
      melding('🪄 Wingardium Leviosa! … men teamet er tomt, så det er ingenting å løfte. Klikk på noen av kandidatene først.');
      return;
    }
    const lagret = lagreTeamIRepo();
    visFormel('Wingardium Leviosa!', 'leviosa');
    await løftTeam();
    const antall = team.length;
    team = [];
    teamNullstilt = true;
    tegnTeam();
    pulsRepoknapp();
    melding(`🪄 Wingardium Leviosa! «${lagret.navn}» (${antall} ${antall === 1 ? 'medlem' : 'medlemmer'}) svevde inn i Team Repository. Teamet er tomt, så du kan bygge et nytt.`);
  } finally {
    formelPågår = false;
  }
}

function melding(tekst) {
  $('minnehint').textContent = tekst;
  $('minnehint').hidden = false;
  if (!$('rutenett').hidden) leggTilBoble('system', tekst);
}

function løftTeam() {
  const medlemmer = [...$('team').querySelectorAll('.medlem')];
  if (redusertBevegelse) return Promise.resolve();
  const mål = document.querySelector('[data-fane="repo"]').getBoundingClientRect();
  return Promise.all(
    medlemmer.map((el, i) => {
      const r = el.getBoundingClientRect();
      const dx = mål.left + mål.width / 2 - (r.left + r.width / 2);
      const dy = mål.top + mål.height / 2 - (r.top + r.height / 2);
      el.style.zIndex = 140; // over sidemenyen mens de flyr
      el.style.pointerEvents = 'none';
      const glød = '0 0 28px #8fd3ff88, 0 0 60px #c69cff55';
      return el.animate(
        [
          { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1, boxShadow: '0 0 0 #0000', offset: 0 },
          { transform: 'translate(0, -22px) rotate(-3deg) scale(1.05)', boxShadow: glød, offset: 0.18 },
          { transform: 'translate(6px, -34px) rotate(3deg) scale(1.07)', boxShadow: glød, offset: 0.4 },
          { transform: 'translate(-6px, -28px) rotate(-3deg) scale(1.07)', boxShadow: glød, offset: 0.58 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${i % 2 ? '-' : ''}400deg) scale(0.12)`, boxShadow: glød, opacity: 0, offset: 1 },
        ],
        { duration: 2300, delay: i * 220, easing: 'ease-in-out', fill: 'forwards' },
      ).finished;
    }),
  );
}

function pulsRepoknapp() {
  const knapp = document.querySelector('[data-fane="repo"]');
  knapp.classList.remove('pulser');
  void knapp.offsetWidth;
  knapp.classList.add('pulser');
}

// ---------------------------------------------------------------- spørring

async function spør(tekst) {
  tekst = tekst.trim();
  if (!tekst || jobber || formelPågår) return;
  if (/^wingardium\s+leviosa[\s!.]*$/i.test(tekst)) return leviosa();
  const glemmer = /^obliviate[\s!.]*$/i.test(tekst);
  setJobber(true, !glemmer);
  if (glemmer) obliviateAnimasjon = spillObliviate();
  $('feil').hidden = true;
  $('stoppmelding').hidden = true;
  $('detalj').innerHTML = '';
  $('oppgave').value = '';
  if (!glemmer) {
    // Samtalen, kandidatkortene og teamet blir stående mellom søkene.
    åpneArbeidsflate();
    leggTilBoble('bruker', tekst);
    startStegBlokk();
    visTenker();
  }

  try {
    const svar = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oppgave: tekst, sesjon, team: team.map((m) => m.id), team_nullstilt: teamNullstilt }),
    });
    if (!svar.ok) throw new Error((await svar.json().catch(() => ({}))).feil ?? `Serveren svarte ${svar.status}.`);

    // Leser NDJSON-strømmen og håndterer hver hendelse etter hvert som den kommer.
    const leser = svar.body.getReader();
    const dekoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      buffer += dekoder.decode(value, { stream: true });
      const linjer = buffer.split('\n');
      buffer = linjer.pop(); // siste linje kan være ufullstendig
      for (const linje of linjer) if (linje.trim()) håndter(JSON.parse(linje));
    }
  } catch (err) {
    nullstillObliviateAnimasjon(); // ble ikke glemt likevel, så vinduet må tilbake
    visFeil(err.message);
  } finally {
    fjernTenker();
    setJobber(false);
  }
}

// ---------------------------------------------------------------- animasjoner

const redusertBevegelse = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Mens agenten jobber: den gylne snobben farer rundt på skjermen, og en trollmann på kost jager den.
const jakt = (() => {
  const rot = $('jakt'), snobb = $('snobb'), harry = $('harry');
  let raf = null, avslutt = null;
  let sx, sy, mx, my, hx, hy, bytt, fart;

  const tilfeldigPunkt = () => ({
    x: 60 + Math.random() * Math.max(window.innerWidth - 160, 100),
    y: 60 + Math.random() * Math.max(window.innerHeight - 160, 100),
  });

  function tikk(t) {
    if (t > bytt) {
      // Snobben skifter retning med korte mellomrom og blir av og til veldig rask.
      ({ x: mx, y: my } = tilfeldigPunkt());
      bytt = t + 450 + Math.random() * 800;
      fart = 0.05 + Math.random() * 0.07;
    }
    const sfx = sx;
    sx += (mx - sx) * fart;
    sy += (my - sy) * fart;
    const flakk = Math.sin(t / 110) * 7;
    snobb.style.transform = `translate3d(${sx}px, ${sy + flakk}px, 0) scaleX(${sx >= sfx ? 1 : -1})`;

    // Harry henger etter, litt bak snobben, og vender seg mot den.
    const hfx = hx;
    hx += (sx - 70 * Math.sign(sx - hx || 1) - hx) * 0.03;
    hy += (sy + 18 - hy) * 0.035;
    const vinkel = Math.max(-25, Math.min(25, (Math.atan2(sy - hy, Math.abs(sx - hx) + 40) * 180) / Math.PI));
    const vender = sx >= hx;
    harry.style.transform = `translate3d(${hx}px, ${hy}px, 0) scaleX(${vender ? 1 : -1}) rotate(${vender ? vinkel : -vinkel}deg)`;
    raf = requestAnimationFrame(tikk);
  }

  return {
    start() {
      if (redusertBevegelse) return;
      clearTimeout(avslutt);
      cancelAnimationFrame(raf);
      rot.classList.remove('ferdig');
      rot.hidden = false;
      ({ x: sx, y: sy } = { x: window.innerWidth * 0.8, y: window.innerHeight * 0.35 });
      ({ x: hx, y: hy } = { x: -80, y: window.innerHeight * 0.6 });
      bytt = 0;
      raf = requestAnimationFrame(tikk);
    },
    stopp() {
      if (rot.hidden) return;
      rot.classList.add('ferdig'); // tones ut, så skjules den
      avslutt = setTimeout(() => {
        cancelAnimationFrame(raf);
        rot.hidden = true;
      }, 500);
    },
  };
})();

// Tryllestavblink med formelen over hele skjermen. `variant` gir fargen: '' er lilla (Obliviate), 'leviosa' er blå og gull.
function visFormel(tekst, variant) {
  const blitz = $('blitz');
  blitz.querySelector('span').textContent = tekst;
  blitz.className = variant;
  blitz.hidden = false;
  void blitz.offsetWidth; // start animasjonen på nytt
  blitz.classList.add('spill');
  blitz.addEventListener('animationend', () => (blitz.hidden = true), { once: true });
}

// Obliviate: et tryllestavblink, så flyr samtalevinduet ut av skjermen. Lover løses når det er borte.
function spillObliviate() {
  visFormel('Obliviate!', '');

  const rutenett = $('rutenett');
  if (rutenett.hidden) return Promise.resolve();
  document.body.classList.add('animerer');
  rutenett.classList.add('flyr-ut');
  return new Promise((ferdig) => {
    // animationend bobler opp fra barna (kortene har egne animasjoner), så sjekk at den kommer fra vinduet selv.
    const ved = (ev) => {
      if (ev.target !== rutenett) return;
      rutenett.removeEventListener('animationend', ved);
      ferdig();
    };
    rutenett.addEventListener('animationend', ved);
    setTimeout(ferdig, 2500); // sikkerhetsnett hvis animasjonen aldri starter
  });
}

function nullstillObliviateAnimasjon() {
  $('rutenett').classList.remove('flyr-ut');
  document.body.classList.remove('animerer');
}

let obliviateAnimasjon = null;

function setJobber(verdi, animer = true) {
  jobber = verdi;
  if (verdi && animer) jakt.start();
  if (!verdi) jakt.stopp();
  $('status').textContent = verdi ? 'Agent jobber …' : 'Agent aktiv';
  $('status').className = `agentstatus${verdi ? ' jobber' : ''}`;
  $('send').disabled = verdi;
  $('send').textContent = verdi ? 'Orakelet ser …' : 'Spør orakelet';
  document.querySelectorAll('#eksempler .chip').forEach((c) => (c.disabled = verdi));
}

function visFeil(melding) {
  $('feil').textContent = `✖ ${melding}`;
  $('feil').hidden = false;
}

// ---------------------------------------------------------------- hendelser

function håndter(h) {
  if (h.type === 'tanke') {
    visTenker(`💭 ${h.tekst.slice(0, 140)}`);
  } else if (h.type === 'verktoy_kall') {
    leggTilSteg(h);
    visTenker('Orakelet jobber …');
  } else if (h.type === 'verktoy_resultat') {
    ferdigSteg(h);
  } else if (h.type === 'resultat') {
    fjernTenker();
    teamNullstilt = false; // agenten har fått beskjed
    visResultat(h);
  } else if (h.type === 'glemt') {
    // Vent til vinduet har fløyet ut før vi rydder bak det.
    (obliviateAnimasjon ?? Promise.resolve()).then(glemAlt);
  } else if (h.type === 'feil') {
    fjernTenker();
    nullstillObliviateAnimasjon();
    visFeil(h.melding);
  }
}

// Obliviate: ny sesjon og et rent grensesnitt, som om siden nettopp var åpnet.
// Samtalen og teamet er borte, men man kan fortsette med nye søk rett etterpå.
function glemAlt() {
  sesjon = nySesjon();
  kandidater = [];
  team = [];
  tegnTeam();
  $('samtale').innerHTML = '';
  $('kandidater').innerHTML = '';
  $('antall').textContent = '';
  $('venter').hidden = false;
  $('rutenett').hidden = true;
  $('hero').classList.remove('kompakt');
  nullstillObliviateAnimasjon();
  obliviateAnimasjon = null;
  stegBlokk = null;
  visForslag('start');
  $('eksempler').hidden = false;
  $('glem').hidden = true;
  $('oppgave').placeholder = 'Vi trenger en senior React-utvikler i Bergen fra desember …';
  $('minnehint').textContent = '✨ Obliviate! Orakelet har glemt samtalen og teamet. Du kan starte et nytt søk.';
  $('minnehint').hidden = false;
}

function leggTilBoble(hvem, tekst) {
  const samtale = $('samtale');
  samtale.insertAdjacentHTML('beforeend', `<div class="boble ${hvem}">${e(tekst)}</div>`);
  samtale.scrollTop = samtale.scrollHeight;
}

// Verktøykallene blir stående i samtalen under spørsmålet, så man ser hva agenten faktisk gjorde: «→ Søker i … ✓».
let stegBlokk = null;

function startStegBlokk() {
  $('samtale').insertAdjacentHTML('beforeend', '<div class="steg"></div>');
  stegBlokk = $('samtale').lastElementChild;
}

function leggTilSteg(h) {
  if (!stegBlokk) return;
  stegBlokk.insertAdjacentHTML(
    'beforeend',
    `<div class="steg-linje" data-id="${e(h.id)}"><span class="pil">→</span> ${e(VERKTØYTEKST[h.navn] ?? h.navn)}<span class="steg-input"> · ${e(sammendrag(h.input))}</span><span class="steg-status">…</span></div>`,
  );
  $('samtale').scrollTop = $('samtale').scrollHeight;
}

function ferdigSteg(h) {
  const linje = [...(stegBlokk?.children ?? [])].find((l) => l.dataset.id === h.id);
  if (!linje) return;
  linje.classList.add(h.ok ? 'ok' : 'feil');
  linje.querySelector('.steg-status').textContent = h.ok ? `✓ ${h.tegn} tegn` : '✖ feilet';
}

// Tenkeboblen viser at agenten jobber, og forsvinner når svaret kommer.
function visTenker(tekst = 'Orakelet tenker …') {
  if (!$('tenker')) $('samtale').insertAdjacentHTML('beforeend', '<div class="boble tenker" id="tenker"></div>');
  $('tenker').textContent = tekst;
  $('samtale').scrollTop = $('samtale').scrollHeight;
}
const fjernTenker = () => $('tenker')?.remove();

// Én kort linje med inputverdiene, så man ser hva det søkes på.
const sammendrag = (input) =>
  Object.values(input ?? {})
    .map((v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)))
    .join(' · ')
    .slice(0, 90);

// ---------------------------------------------------------------- kandidater

function visResultat(h) {
  $('venter').hidden = true;
  if (h.sammendrag) leggTilBoble('orakel', h.sammendrag);
  // Det agenten ikke vet eller ikke fant, tydelig adskilt fra selve svaret.
  for (const notat of h.usikkerhet ?? []) leggTilBoble('usikkert', notat);
  if (h.hukommelse_full) leggTilBoble('system', '🧠 Hukommelsen begynner å bli full. Skriv «Obliviate» for å starte på nytt.');
  if (STOPPMELDING[h.stopp]) {
    $('stoppmelding').textContent = `⚠ ${STOPPMELDING[h.stopp]}`;
    $('stoppmelding').hidden = false;
  }
  // Et oppfølgingsspørsmål gir ofte ingen nye kort. Da blir kortene fra forrige svar stående.
  if (!h.kandidater.length) return;
  const iBruk = new Set(kandidater.map((k) => k.id));
  if (!h.nytt_sok && h.kandidater.every((k) => iBruk.has(k.id))) {
    // Oppfølging om kandidater vi allerede viser: oppdater kortene (f.eks. med opplæringsplan), behold rekkefølgen.
    const oppdatert = new Map(h.kandidater.map((k) => [k.id, k]));
    kandidater = kandidater.map((k) => ({ ...(oppdatert.get(k.id) ?? k), rang: k.rang }));
  } else {
    kandidater = h.kandidater;
  }
  $('antall').textContent = `${kandidater.length} vist`;
  $('kandidater').innerHTML = kandidater.map(kort).join('');
}

function kort(k, i) {
  const [tekst, klasse] = TIDSPUNKT[k.tidspunkt];
  const a = k.tilgjengelighet;
  const ferdigheter = k.matchendeFerdigheter.length
    ? k.matchendeFerdigheter.map((f) => `<span class="ferdighet">${e(f.ferdighet)} <b>${f.nivå}/5</b></span>`).join('')
    : '<span class="meta">Ingen direkte treff i profilen</span>';
  return `<div class="kandidat${team.some((m) => m.id === k.id) ? ' i-team' : ''}" role="button" tabindex="0" data-id="${e(k.id)}" style="animation-delay:${i * 250}ms">
    <div class="portrett"><img src="${portrett(k.id)}" alt="" loading="lazy" decoding="async"><span class="rang">#${k.rang}</span></div>
    <div class="innhold">
      <div class="rad"><span class="soul-class">${e(k.rolle)}</span><span class="soul-rank${k.grad === 'E' ? ' legend' : ''}">Grad ${e(k.grad)} · ${RANG[k.grad] ?? ''}</span></div>
      <div><div class="soul-name">${e(k.navn)}</div><div class="soul-meta">${e(k.lokasjon)}</div></div>
      <div class="seksjon"><span class="etikett">Faglig match</span><div class="ferdigheter">${ferdigheter}</div></div>
      <div class="seksjon"><span class="etikett">Tilgjengelighet</span><span class="merke ${klasse}">${tekst}</span>
        ${a ? `<span class="meta">ledig fra ${e(a.ledig_fra)} · ${a.ledig_prosent} %</span>` : ''}
        ${a?.kommentar ? `<span class="meta kommentar">${e(a.kommentar)}</span>` : ''}
      </div>
      <p class="begrunnelse">${e(k.begrunnelse)}</p>
      ${k.avvik ? `<p class="avvik">⚠ Avvik i dataene: ${e(k.avvik)}</p>` : ''}
      ${gapBlokk(k.gap)}
      <div class="kort-handling">
        <span class="legg-til">＋ Klikk for å legge til i teamet</span>
        <span class="team-merke">✓ I teamet</span>
        <button type="button" class="profil-knapp">Se profil ↗</button>
      </div>
    </div>
  </div>`;
}

const dato = (iso) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });

const dager = (fra, til) => Math.round((new Date(til) - new Date(fra)) / 86400000);

// Nesten-treff: hva som mangler, opplæringsplanen som tidslinje og liste, og om de rekker det før de blir ledige.
// Planen er alltid synlig, siden den er hele poenget med å vise en kandidat som ikke er et fullt treff.
function gapBlokk(g) {
  if (!g) return '';
  const mangler = g.mangler.map((m) => `${e(m.ferdighet)} ${m.naa}→${m.krav}`).join(', ');
  const utenKurs = g.uten_kurs.length ? `<p class="meta">Ingen kurs i katalogen for: ${e(g.uten_kurs.join(', '))}</p>` : '';
  const hode = `<div class="gaphode"><span class="merke gul">Nesten!</span> Mangler ${mangler}</div>`;
  if (!g.plan.length) return `<div class="gap">${hode}${utenKurs}</div>`;

  const start = g.plan[0].start;
  const total = Math.max(dager(start, g.klar_dato), 1);
  const barer = g.plan
    .map((p) => `<div class="kursbar ${p.tema}" style="flex:${Math.max(dager(p.start, p.slutt), 1)}" title="${e(p.navn)}">${e(p.ferdighet)}</div>`)
    .join('');
  // Markør for når kandidaten blir ledig, hvis det skjer mens opplæringen pågår.
  const d = g.ledig_fra ? dager(start, g.ledig_fra) : null;
  const markør = d !== null && d > 0 && d < total
    ? `<span class="ledigmerke" style="left:${(d / total) * 100}%" title="Ledig fra ${dato(g.ledig_fra)}">▼ ledig</span>`
    : '';
  const plan = g.plan
    .map((p) => `<li>${p.tema === 'halloween' ? '🎃 ' : ''}<b>${e(p.navn)}</b> <span class="meta">${p.fra_niva}→${p.til_niva} · ${p.timer} t · ${dato(p.start)}–${dato(p.slutt)}</span></li>`)
    .join('');

  let status = `Klar ${dato(g.klar_dato)}`;
  let klasse = '';
  if (g.ledig_fra) {
    const diff = dager(g.klar_dato, g.ledig_fra);
    klasse = diff >= 0 ? 'klar-ok' : 'klar-sent';
    status = diff >= 0
      ? `✓ Klar ${dato(g.klar_dato)}, ${diff} dager før de blir ledige (${dato(g.ledig_fra)})`
      : `Klar ${dato(g.klar_dato)}, ${-diff} dager etter at de blir ledige (${dato(g.ledig_fra)})`;
  }
  return `<div class="gap">${hode}
    <p class="etikett">Opplæringsplan · ${g.totalt_timer} t</p>
    <div class="tidslinje">${markør}<div class="kursbarer">${barer}</div><div class="akse"><span>${dato(start)}</span><span>${dato(g.klar_dato)}</span></div></div>
    <ol class="plan">${plan}</ol>
    <p class="klar ${klasse}">${status}</p>${utenKurs}</div>`;
}

// ---------------------------------------------------------------- markdown

// Liten markdown-visning for CV-ene: overskrifter, fet og kursiv, kode, lenker, lister, sitat og avsnitt.
// All tekst escapes før noe tolkes, så innholdet i en CV aldri kan bli til HTML.
// Enkle linjeskift beholdes som linjeskift, slik at «Nøkkelkompetanse» og «Utvalgte oppdrag» blir stående på hver sin linje.
function markdownTilHtml(md) {
  const inline = (tekst) =>
    e(tekst)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
      .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?![*\w])/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const liste = (linjer, mønster, tagg) =>
    `<${tagg}>${linjer.map((l) => `<li>${inline(l.replace(mønster, ''))}</li>`).join('')}</${tagg}>`;

  return md
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((blokk) => {
      const linjer = blokk.split('\n');
      const overskrift = linjer[0].match(/^(#{1,6})\s+(.*)$/);
      if (overskrift) {
        const nivå = Math.min(overskrift[1].length + 3, 6); // # blir h4, siden navnet allerede er h2 i arket
        const rest = linjer.slice(1).join('\n');
        return `<h${nivå} class="md-h">${inline(overskrift[2])}</h${nivå}>${rest ? markdownTilHtml(rest) : ''}`;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(blokk)) return '<hr>';
      if (linjer.every((l) => /^\s*[-*+]\s+/.test(l))) return liste(linjer, /^\s*[-*+]\s+/, 'ul');
      if (linjer.every((l) => /^\s*\d+[.)]\s+/.test(l))) return liste(linjer, /^\s*\d+[.)]\s+/, 'ol');
      if (linjer.every((l) => /^\s*>/.test(l))) return `<blockquote>${linjer.map((l) => inline(l.replace(/^\s*>\s?/, ''))).join('<br>')}</blockquote>`;
      return `<p>${linjer.map(inline).join('<br>')}</p>`;
    })
    .join('');
}

// ---------------------------------------------------------------- detaljpanel

async function åpneDetalj(k) {
  $('detalj').innerHTML = `<div class="bakteppe"><section class="character-sheet" role="dialog" aria-modal="true" aria-label="${e(k.navn)}">
    <div class="sheet-topbar"><span>✦ <strong>THE CHARACTER GRIMOIRE</strong> <span class="sheet-id">${e(k.id.toUpperCase())}</span></span><button type="button" class="lukk" aria-label="Lukk">×</button></div>
    <div class="sheet-layout">
      <div class="sheet-artcol">
        <img class="sheet-portrait" src="${portrett(k.id)}" alt="">
        <div class="sheet-art-under"><span class="ritual-caption">✧ ORAKELETS DOM</span><p>${e(k.begrunnelse)}</p></div>
      </div>
      <div class="sheet-data">
        <div class="sheet-eyebrow">Grad ${e(k.grad)} / ${RANG[k.grad] ?? ''}</div>
        <h2>${e(k.navn)}</h2>
        <p class="sheet-job">${e(k.rolle)}</p>
        <div class="sheet-pills"><span class="sheet-pill">${e(k.lokasjon)}</span><span class="sheet-pill">GRAD ${e(k.grad)}</span></div>
        ${k.avvik ? `<p class="avvik">⚠ Avvik i dataene: ${e(k.avvik)}</p>` : ''}
        ${gapBlokk(k.gap)}
        <div id="detalj-innhold"><p class="tom">Henter …</p></div>
      </div>
    </div>
  </section></div>`;

  const lukk = () => {
    $('detalj').innerHTML = '';
    document.removeEventListener('keydown', escLukk);
  };
  const escLukk = (ev) => ev.key === 'Escape' && lukk();
  document.addEventListener('keydown', escLukk);
  $('detalj').querySelector('.bakteppe').addEventListener('click', (ev) => ev.target === ev.currentTarget && lukk());
  $('detalj').querySelector('.lukk').addEventListener('click', lukk);

  try {
    const svar = await fetch(`/api/konsulenter/${encodeURIComponent(k.id)}`);
    if (!svar.ok) throw new Error('Fant ikke konsulenten.');
    const d = await svar.json();
    const treff = new Set(k.matchendeFerdigheter.map((f) => f.ferdighet));
    const a = d.tilgjengelighet;
    const innhold = $('detalj-innhold');
    if (!innhold) return; // panelet ble lukket mens vi ventet
    const datoMedÅr = (iso) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
    innhold.innerHTML = `
      <h3 class="sheet-h3">✧ Tilgjengelighet</h3>
      ${a ? `<div class="stats-grid">
          <div class="stat-box"><span class="stat-val">${e(datoMedÅr(a.ledig_fra))}</span><span class="stat-name">Ledig fra</span></div>
          <div class="stat-box"><span class="stat-val">${a.ledig_prosent} %</span><span class="stat-name">Ledig kapasitet</span></div>
          <div class="stat-box"><span class="stat-val">${a.nåværende_oppdrag?.til ? e(datoMedÅr(a.nåværende_oppdrag.til)) : '–'}</span><span class="stat-name">Oppdrag til</span></div>
        </div>
        ${a.nåværende_oppdrag ? `<p class="meta" style="margin-top:10px">Nå hos ${e(a.nåværende_oppdrag.kunde)}</p>` : ''}
        ${a.kommentar ? `<p class="avvik" style="margin-top:10px">${e(a.kommentar)}</p>` : ''}` : '<p class="meta">Ingen tilgjengelighetsdata.</p>'}
      <h3 class="sheet-h3">⚔ Kompetanse</h3>
      <div class="all-skills">${[...d.konsulent.kompetanse]
        .sort((x, y) => y.nivå - x.nivå)
        .map((f) => `<span class="full-skill${treff.has(f.ferdighet) ? ' treff' : ''}">${e(f.ferdighet)}<strong>${f.nivå}/5</strong></span>`)
        .join('')}</div>
      ${d.konsulent.sertifiseringer.length ? `<h3 class="sheet-h3">✦ Sertifiseringer</h3><div class="relic-list">${d.konsulent.sertifiseringer.map((s) => `<div class="relic">${e(s)}</div>`).join('')}</div>` : ''}
      <p class="meta" style="margin-top:14px">Språk: ${e(d.konsulent.språk.join(', '))}</p>
      <h3 class="sheet-h3">☾ Prosjekter</h3>
      ${d.prosjekter.length ? `<div class="spell-list">${d.prosjekter
        .map((p) => `<div class="spell-row"><strong>${e(p.kunde)} · ${e(p.bransje)} · ${p.år}</strong><span class="meta">${e(p.rolle)} — ${e(p.teknologier.join(', '))}</span></div>`)
        .join('')}</div>` : '<p class="meta">Ingen prosjekthistorikk.</p>'}
      <h3 class="sheet-h3">✶ CV</h3>
      ${d.cv ? `<div class="lore-text markdown">${markdownTilHtml(d.cv)}</div>` : '<p class="meta">Ingen CV registrert.</p>'}`;
  } catch (err) {
    const innhold = $('detalj-innhold');
    if (innhold) innhold.innerHTML = `<p class="feil">✖ ${e(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------- faner og kurskatalog

let kurs = null;
let kursTema = '';

document.querySelector('.faner').addEventListener('click', (ev) => {
  const fane = ev.target.closest('.fane');
  if (fane) byttFane(fane.dataset.fane);
});

async function byttFane(navn) {
  const fane = document.querySelector(`.fane[data-fane="${navn}"]`);
  document.querySelectorAll('.fane').forEach((f) => f.classList.toggle('aktiv', f === fane));
  $('denne-siden').textContent = fane.dataset.side;
  $('sidemeny').classList.remove('apen');
  $('orakel').hidden = navn !== 'orakel';
  $('kurs').hidden = navn !== 'kurs';
  $('repo').hidden = navn !== 'repo';
  if (navn === 'kurs' && !kurs) {
    try {
      kurs = await (await fetch('/api/kurs')).json();
    } catch {
      $('kursliste').innerHTML = '<p class="feil">✖ Fikk ikke hentet kurskatalogen.</p>';
      return;
    }
    tegnKurs();
  }
}

document.querySelector('.kursfilter').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  kursTema = chip.dataset.tema;
  document.querySelectorAll('.kursfilter .chip').forEach((c) => c.classList.toggle('aktiv', c === chip));
  tegnKurs();
});
$('kurssok').addEventListener('input', tegnKurs);

function tegnKurs() {
  const søk = $('kurssok').value.trim().toLowerCase();
  const treff = kurs.filter(
    (c) => (!kursTema || c.tema === kursTema) && (!søk || `${c.navn} ${c.ferdighet} ${c.beskrivelse}`.toLowerCase().includes(søk)),
  );
  $('kursantall').textContent = `${treff.length} av ${kurs.length} kurs`;
  $('kursliste').innerHTML = treff
    .map(
      (c) => `<article class="kurskort ${c.tema}">
      <div class="rad"><span class="soul-class">${c.tema === 'halloween' ? '🎃 Halloween' : 'Teknologi'}</span><span class="meta">${c.timer} t</span></div>
      <strong>${e(c.navn)}</strong>
      <p class="meta">${e(c.ferdighet)} · nivå ${c.fra_niva}→${c.til_niva} · ${e(c.format)}</p>
      <p>${e(c.beskrivelse)}</p></article>`,
    )
    .join('');
}
