const TIDSPUNKT = {
  ja: { tekst: 'Ledig', klasse: 'gronn' },
  delvis: { tekst: 'Delvis tilgjengelig', klasse: 'gul' },
  nei: { tekst: 'Ikke ledig', klasse: 'rod' },
  ukjent: { tekst: 'Ukjent', klasse: 'ukjent' },
};

export default function Kandidater({ resultat, jobber, melding, onVelg }) {
  const kandidater = resultat?.kandidater ?? [];
  return (
    <section className="panel">
      <h3>
        Kandidater {resultat && <span className="antall">{kandidater.length} funnet</span>}
      </h3>
      {!resultat && <p className="tom">{jobber ? 'Kandidatene dukker opp når orakelet er ferdig.' : ''}</p>}
      {melding && <p className="feil">⚠ {melding}</p>}
      {resultat?.sammendrag && <p className="oppsummering">{resultat.sammendrag}</p>}
      <div className="kort-liste">
        {kandidater.map((k, i) => (
          <Kort key={k.id} k={k} forsinkelse={i * 250} onVelg={onVelg} />
        ))}
      </div>
    </section>
  );
}

function Kort({ k, forsinkelse, onVelg }) {
  const t = TIDSPUNKT[k.tidspunkt];
  const a = k.tilgjengelighet;
  return (
    <button className="kandidat" style={{ animationDelay: `${forsinkelse}ms` }} onClick={() => onVelg(k)}>
      <div className="rang">#{k.rang}</div>
      <div className="innhold">
        <div className="rad">
          <strong>{k.navn}</strong>
          <span className="meta">
            {k.rolle} · grad {k.grad} · {k.lokasjon}
          </span>
        </div>

        <div className="seksjon">
          <span className="etikett">Faglig match</span>
          <div className="ferdigheter">
            {k.matchendeFerdigheter.length ? (
              k.matchendeFerdigheter.map((f) => (
                <span key={f.ferdighet} className="ferdighet">
                  {f.ferdighet} <b>{f.nivå}/5</b>
                </span>
              ))
            ) : (
              <span className="meta">Ingen direkte treff i profilen</span>
            )}
          </div>
        </div>

        <div className="seksjon">
          <span className="etikett">Tilgjengelighet</span>
          <span className={`merke ${t.klasse}`}>{t.tekst}</span>
          {a && (
            <span className="meta">
              ledig fra {a.ledig_fra} · {a.ledig_prosent} %
            </span>
          )}
          {a?.kommentar && <span className="meta kommentar">{a.kommentar}</span>}
        </div>

        <p className="begrunnelse">{k.begrunnelse}</p>
        {k.avvik && <p className="avvik">⚠ Avvik i dataene: {k.avvik}</p>}
      </div>
    </button>
  );
}
