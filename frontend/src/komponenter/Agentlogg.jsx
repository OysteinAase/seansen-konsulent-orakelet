const IKON = { kjører: '⏳', ok: '✓', feil: '✖' };

export default function Agentlogg({ logg, jobber }) {
  return (
    <section className="panel">
      <h3>Agentens arbeid</h3>
      <ol className="logg">
        {logg.map((e, i) =>
          e.slag === 'tanke' ? (
            <li key={i} className="tanke">
              {e.tekst}
            </li>
          ) : (
            <li key={e.id} className={`verktoy s-${e.status}`}>
              <details>
                <summary>
                  <span className="ikon">{IKON[e.status]}</span>
                  <code>{e.navn}</code>
                  <span className="kort">{sammendrag(e.input)}</span>
                  {e.tegn != null && <span className="tegn">{e.tegn} tegn</span>}
                </summary>
                <p className="etikett">Input</p>
                <pre>{JSON.stringify(e.input, null, 2)}</pre>
                {e.resultat != null && (
                  <>
                    <p className="etikett">Resultat</p>
                    <pre>{e.resultat}</pre>
                  </>
                )}
              </details>
            </li>
          ),
        )}
        {jobber && <li className="venter">Orakelet tenker …</li>}
      </ol>
    </section>
  );
}

// Én linje med inputverdiene, så loggen kan skannes uten å åpne hvert kall.
function sammendrag(input) {
  return Object.values(input ?? {})
    .map((v) => (Array.isArray(v) ? v.join(', ') : String(v)))
    .join(' · ');
}
