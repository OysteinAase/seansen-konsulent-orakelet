# Agentløkka

Implementert i `kjørAgent` i [agent.js](../src/agent.js). Mønsteret: spør modellen, kjør verktøyene den ber om, send resultatene tilbake, gjenta til den er ferdig.

## Sekvens

```mermaid
sequenceDiagram
    actor B as Bruker
    participant I as index.js
    participant A as agent.js
    participant M as Claude-modell
    participant V as verktoy.js
    participant D as data/

    B->>I: npm start -- "behov"
    I->>A: kjørAgent(system, oppgave, verktøy)
    A->>A: filtrer verktøy med kjør-funksjon
    loop opptil MAX_ITERASJONER
        A->>M: messages.create(system, tools, messages)
        M-->>A: svar (tekst og/eller tool_use)
        alt stop_reason = tool_use
            loop for hvert verktøykall
                A->>V: kjør(input)
                V->>D: les JSON / markdown
                D-->>V: rader
                V-->>A: resultat eller feil
            end
            A->>A: legg tool_result i én user-melding
        else stop_reason = end_turn
            A-->>B: skriver ut endelig svar
        end
    end
```

## Tilstandsmaskin

```mermaid
stateDiagram-v2
    [*] --> SpørModell
    SpørModell --> KjørVerktøy: stop_reason = tool_use
    KjørVerktøy --> SpørModell: tool_result sendt tilbake
    SpørModell --> Ferdig: end_turn
    SpørModell --> Avbrutt: refusal
    SpørModell --> Avbrutt: max_tokens
    SpørModell --> Avbrutt: MAX_ITERASJONER nådd
    Ferdig --> [*]
    Avbrutt --> [*]
```

## Stoppbetingelser

| Betingelse | Resultat |
|---|---|
| `end_turn` | Modellen er ferdig. Svaret skrives ut |
| `refusal` | Modellen avslo. Kategorien vises hvis den finnes |
| `max_tokens` | Svaret ble kuttet |
| `MAX_ITERASJONER` | Agenten gikk i ring. Løkka stopper med en melding |

## Verktøyfeil

```mermaid
flowchart TD
    Kall["tool_use fra modellen"] --> Finnes{"Verktøyet finnes<br/>og har kjør?"}
    Finnes -- nei --> Ukjent["is_error: Ukjent verktøy,<br/>med liste over gyldige"]
    Finnes -- ja --> Kjør["await kjør(input)"]
    Kjør -- kaster --> Feil["is_error: e.message"]
    Kjør -- ok --> Ok["tool_result<br/>(JSON eller tekst)"]
    Ukjent --> Tilbake["Sendes til modellen"]
    Feil --> Tilbake
    Ok --> Tilbake
    Tilbake --> Prøv["Modellen kan prøve på nytt<br/>med korrigert input"]
```

Feilmeldingen er det modellen ser, så den bør forklare hva som var galt og hva den kan gjøre i stedet.

## Detaljer å vite om

- Modellen kan be om flere verktøy i samme svar. Alle resultatene må sendes tilbake i én og samme melding.
- Tekst som kommer sammen med et verktøykall vises i grått. Endelig svar vises i vanlig farge.
- Hvert verktøykall logges som `→ navn {input}`, og resultatet som `✓ N tegn tilbake` eller `✖ feilmelding`.
