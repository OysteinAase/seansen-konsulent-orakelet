import { useRef, useState } from 'react';
import { match } from './api.js';
import Agentlogg from './komponenter/Agentlogg.jsx';
import Kandidater from './komponenter/Kandidater.jsx';
import Detalj from './komponenter/Detalj.jsx';

const EKSEMPLER = [
  'Vi trenger noen som kan Terraform og Azure, ledig fra november, helst C-grad eller over.',
  'Vi trenger en senior React-utvikler i Bergen fra desember, helst med erfaring fra finans.',
  'Hvem kan lede et dataplattformprosjekt i Trondheim, og er ledig før nyttår?',
];

const STOPPMELDING = {
  refusal: 'Modellen avslo å svare.',
  max_tokens: 'Svaret ble kuttet.',
  maks_iterasjoner: 'Agenten brukte opp antall tillatte runder.',
};

export default function App() {
  const [oppgave, setOppgave] = useState('');
  const [status, setStatus] = useState('ledig'); // ledig | jobber | ferdig | feil
  const [logg, setLogg] = useState([]);
  const [resultat, setResultat] = useState(null);
  const [feil, setFeil] = useState(null);
  const [valgt, setValgt] = useState(null);
  const avbryt = useRef(null);

  // Hver hendelse fra serveren blir en linje i agentloggen.
  const håndter = (h) => {
    if (h.type === 'tanke') setLogg((l) => [...l, { slag: 'tanke', tekst: h.tekst }]);
    else if (h.type === 'verktoy_kall') setLogg((l) => [...l, { slag: 'verktoy', id: h.id, navn: h.navn, input: h.input, status: 'kjører' }]);
    else if (h.type === 'verktoy_resultat') {
      setLogg((l) => l.map((e) => (e.id === h.id ? { ...e, status: h.ok ? 'ok' : 'feil', tegn: h.tegn, resultat: h.resultat } : e)));
    } else if (h.type === 'resultat') {
      setResultat(h);
      setStatus('ferdig');
    } else if (h.type === 'feil') {
      setFeil(h.melding);
      setStatus('feil');
    }
  };

  const spør = async (tekst = oppgave) => {
    if (!tekst.trim() || status === 'jobber') return;
    setOppgave(tekst);
    setStatus('jobber');
    setLogg([]);
    setResultat(null);
    setFeil(null);
    setValgt(null);
    avbryt.current = new AbortController();
    try {
      await match(tekst, håndter, avbryt.current.signal);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setFeil(e.message);
        setStatus('feil');
      }
    }
  };

  return (
    <div className="side">
      <header className="topp">
        <div className="logo">
          <span className="kule">🔮</span>
          <div>
            <h1>Seansen</h1>
            <small>KONSULENT-ORAKELET</small>
          </div>
        </div>
        <span className={`agentstatus ${status}`}>{status === 'jobber' ? 'Agent jobber …' : 'Agent aktiv'}</span>
      </header>

      <section className="hero">
        <h2>Hvem kan ta jobben? 🔮</h2>
        <p>Beskriv behovet. La orakelet finne den rette konsulenten.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            spør();
          }}
        >
          <textarea
            value={oppgave}
            onChange={(e) => setOppgave(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) spør();
            }}
            placeholder="Vi trenger en senior React-utvikler i Bergen fra desember …"
            rows={3}
            maxLength={1000}
          />
          <button type="submit" disabled={status === 'jobber' || !oppgave.trim()}>
            {status === 'jobber' ? 'Orakelet ser …' : 'Spør orakelet'}
          </button>
        </form>
        <div className="eksempler">
          {EKSEMPLER.map((e) => (
            <button key={e} type="button" className="chip" disabled={status === 'jobber'} onClick={() => spør(e)}>
              {e}
            </button>
          ))}
        </div>
      </section>

      {feil && <div className="feil">✖ {feil}</div>}

      {status !== 'ledig' && (
        <main className="rutenett">
          <Agentlogg logg={logg} jobber={status === 'jobber'} />
          <Kandidater
            resultat={resultat}
            jobber={status === 'jobber'}
            melding={resultat && STOPPMELDING[resultat.stopp]}
            onVelg={setValgt}
          />
        </main>
      )}

      {valgt && <Detalj kandidat={valgt} onLukk={() => setValgt(null)} />}
    </div>
  );
}
