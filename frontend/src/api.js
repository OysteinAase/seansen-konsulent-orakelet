// Leser NDJSON-strømmen fra /api/match og kaller `ved` for hver hendelse.
export async function match(oppgave, ved, signal) {
  const svar = await fetch('/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oppgave }),
    signal,
  });
  if (!svar.ok) {
    const { feil } = await svar.json().catch(() => ({}));
    throw new Error(feil ?? `Serveren svarte ${svar.status}.`);
  }

  const leser = svar.body.getReader();
  const dekoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    buffer += dekoder.decode(value, { stream: true });
    const linjer = buffer.split('\n');
    buffer = linjer.pop(); // siste linje kan være ufullstendig
    for (const linje of linjer) if (linje.trim()) ved(JSON.parse(linje));
  }
}

export async function hentKonsulent(id) {
  const svar = await fetch(`/api/konsulenter/${encodeURIComponent(id)}`);
  if (!svar.ok) throw new Error('Fant ikke konsulenten.');
  return svar.json();
}
