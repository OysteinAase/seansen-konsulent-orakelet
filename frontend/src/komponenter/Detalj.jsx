import { useEffect, useState } from 'react';
import { hentKonsulent } from '../api.js';

export default function Detalj({ kandidat, onLukk }) {
  const [data, setData] = useState(null);
  const [feil, setFeil] = useState(null);

  useEffect(() => {
    hentKonsulent(kandidat.id).then(setData, (e) => setFeil(e.message));
  }, [kandidat.id]);

  useEffect(() => {
    const lukkMedEsc = (e) => e.key === 'Escape' && onLukk();
    window.addEventListener('keydown', lukkMedEsc);
    return () => window.removeEventListener('keydown', lukkMedEsc);
  }, [onLukk]);

  const treff = new Set(kandidat.matchendeFerdigheter.map((f) => f.ferdighet));

  return (
    <div className="bakteppe" onClick={onLukk}>
      <aside className="detalj" onClick={(e) => e.stopPropagation()}>
        <button className="lukk" onClick={onLukk} aria-label="Lukk">
          ✕
        </button>
        <h2>{kandidat.navn}</h2>
        <p className="meta">
          {kandidat.rolle} · grad {kandidat.grad} · {kandidat.lokasjon}
        </p>

        <h4>Hvorfor orakelet anbefaler</h4>
        <p>{kandidat.begrunnelse}</p>
        {kandidat.avvik && <p className="avvik">⚠ Avvik i dataene: {kandidat.avvik}</p>}

        {feil && <p className="feil">✖ {feil}</p>}
        {!data && !feil && <p className="tom">Henter …</p>}

        {data && (
          <>
            <h4>Kompetanse</h4>
            <ul className="nivaer">
              {[...data.konsulent.kompetanse]
                .sort((a, b) => b.nivå - a.nivå)
                .map((f) => (
                  <li key={f.ferdighet} className={treff.has(f.ferdighet) ? 'treff' : ''}>
                    <span>{f.ferdighet}</span>
                    <span className="stolpe">
                      <i style={{ width: `${f.nivå * 20}%` }} />
                    </span>
                    <b>{f.nivå}/5</b>
                  </li>
                ))}
            </ul>
            {data.konsulent.sertifiseringer.length > 0 && (
              <p className="meta">Sertifiseringer: {data.konsulent.sertifiseringer.join(', ')}</p>
            )}
            <p className="meta">Språk: {data.konsulent.språk.join(', ')}</p>

            <h4>Tilgjengelighet</h4>
            {data.tilgjengelighet ? (
              <>
                <p>
                  Ledig fra {data.tilgjengelighet.ledig_fra} · {data.tilgjengelighet.ledig_prosent} %
                </p>
                {data.tilgjengelighet.nåværende_oppdrag && (
                  <p className="meta">
                    Nå hos {data.tilgjengelighet.nåværende_oppdrag.kunde}
                    {data.tilgjengelighet.nåværende_oppdrag.til && ` til ${data.tilgjengelighet.nåværende_oppdrag.til}`}
                  </p>
                )}
                {data.tilgjengelighet.kommentar && <p className="meta kommentar">{data.tilgjengelighet.kommentar}</p>}
              </>
            ) : (
              <p className="meta">Ingen tilgjengelighetsdata.</p>
            )}

            <h4>Prosjekter</h4>
            {data.prosjekter.length ? (
              <ul className="prosjekter">
                {data.prosjekter.map((p, i) => (
                  <li key={i}>
                    <b>{p.kunde}</b> · {p.bransje} · {p.år}
                    <br />
                    <span className="meta">
                      {p.rolle} — {p.teknologier.join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta">Ingen prosjekthistorikk.</p>
            )}

            <h4>CV</h4>
            {data.cv ? <pre className="cv">{data.cv}</pre> : <p className="meta">Ingen CV registrert.</p>}
          </>
        )}
      </aside>
    </div>
  );
}
