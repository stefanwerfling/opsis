# Sicherheit

Ergebnis des Security-Reviews aus Phase 6 (Stand v0.1). Grundlage sind die Grundsätze in
[01 §6](architecture/01-overview.md) und die Entscheidungen E1/E2 in
[08](architecture/08-risks-and-decisions.md).

## Bedrohungsmodell

OPSIS läuft lokal, mit einem Menschen pro Installation (E1). Agenten sind Programme mit
eigenem Token, die nur über `/mcp` arbeiten. Geschützt werden soll gegen:

1. **Fremde Webseiten im Browser des Nutzers** (CSRF, DNS-Rebinding), die die lokale API
   ansteuern.
2. **Agenten**, die Daten fremder Projekte lesen oder Spezifikationen ändern oder freigeben
   wollen (Grundsatz 10: nur der Mensch gibt frei).
3. **Bösartige Dateien**: Bilder (Dekompressionsbomben, Formatverwechslung) und ZIP-Importe
   (Zip-Bomben, Pfade, manipulierte Hashes).
4. **Informationsabfluss** über Fehlermeldungen und Logs.

Nicht geschützt wird gegen andere Prozesse desselben Benutzers. Sie können die SQLite-Datei
und das Datenverzeichnis ohnehin lesen.

## Maßnahmen und Prüfergebnis

| Bereich        | Maßnahme                                                                                                                                                                                                                                                                                                                                           | Test                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Bindung        | Standard `127.0.0.1`. Eine Adresse außerhalb von Loopback wird **abgelehnt**, außer mit `OPSIS_UNSAFE_BIND=1`.                                                                                                                                                                                                                                     | `http/host-guard.test.ts`          |
| DNS-Rebinding  | Der `Host`-Header muss ein erlaubter Name sein (`localhost`, `127.0.0.1`, `[::1]`, `OPSIS_ALLOWED_HOSTS`). Das gilt für alle Routen einschließlich `/mcp`.                                                                                                                                                                                         | `host-guard.test.ts`               |
| CSRF           | Zustandsändernde Requests mit fremdem `Origin` oder mit `Sec-Fetch-Site: cross-site/same-site` ergeben 403. CORS ist nicht aktiviert, Antworten sind also nicht cross-origin lesbar.                                                                                                                                                               | `host-guard.test.ts`               |
| Web-UI         | CSP nur `'self'`, kein Inline-Script, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`. DOM-Aufbau nur über Text-Knoten, kein `innerHTML`.                                                                                                                                                                                                        | `web-ui.test.ts`                   |
| Agent-Auth     | Bearer-Token `opsis_` plus 256 Bit Zufall, gespeichert wird nur SHA-256. Widerruf wirkt sofort. Einheitliche 401 ohne Hinweis auf den Grund.                                                                                                                                                                                                       | `agents.test.ts`, `mcp.test.ts`    |
| Projektzugriff | `AccessPolicy` in jedem Use-Case. Fremde IDs ergeben `NOT_FOUND`, so lässt sich die Existenz nicht erkennen. Tabellengetrieben für jedes Tool getestet.                                                                                                                                                                                            | `mcp.test.ts`                      |
| Agentenrechte  | Es gibt keine Tools zum Bearbeiten oder Freigeben. Use-Cases für Entwurf und Freigabe verlangen einen Menschen (`FORBIDDEN_ACTOR`). Einzige Ausnahme: Vorschläge (`opsis_propose_components`) **vor** Beginn der Prüfung, nur hinzufügend und als `auto_detected` markiert. Den unfertigen Stand des Menschen liest der Agent nicht (`NOT_READY`). | `mcp.test.ts`, `use-cases.test.ts` |
| Upload-Slots   | Einmal-Token `opsisupl_` (256 Bit, nur SHA-256 gespeichert), 15 min gültig, im Request-Log geschwärzt. Ein widerrufener Agent kann ihn nicht mehr einlösen.                                                                                                                                                                                        | `uploads.test.ts`                  |
| Bilder         | Whitelist PNG/JPEG/WebP über Magic Bytes **und** vollständiges Dekodieren. `limitInputPixels` (40 MP), max. 20 MB und 16 384 px Kante. Ablage inhaltsadressiert, nie unter Pfaden aus Eingaben. Ausgeliefert mit gespeichertem MIME-Typ und `nosniff`.                                                                                             | `files.test.ts`, `api.test.ts`     |
| Pixel-Diff     | Vergleich auf höchstens 12 MP verkleinert (unter ~150 MB Speicher).                                                                                                                                                                                                                                                                                | Review                             |
| ZIP-Import     | Exakte Dateiliste laut Manifest (keine fremden Pfade), Hash und Größe je Eintrag. `validateEntrySizes` erkennt gefälschte Größenangaben. Limits je Eintrag, gesamt und je Archiv. Snapshot, Prompt und Bilder werden erneut gehasht und geprüft.                                                                                                   | `import.test.ts`                   |
| SQL            | Ausschließlich benannte Parameter. Dynamische Teile sind nur feste Spaltenfragmente und Platzhalterlisten.                                                                                                                                                                                                                                         | Review                             |
| Fehler         | REST: interne Fehler als `INTERNAL` ohne Details, Ursache nur im Log. MCP-Tools und -Ressourcen ebenso. Pfade und SQL-Meldungen erreichen den Agenten nicht.                                                                                                                                                                                       | `mcp.test.ts`                      |
| Logs           | Kein Logging von Headern (also keine Tokens). Upload-URLs werden geschwärzt.                                                                                                                                                                                                                                                                       | `uploads.test.ts`                  |
| Abhängigkeiten | `npm audit --omit=dev`: 0 Schwachstellen (Stand des Reviews).                                                                                                                                                                                                                                                                                      | –                                  |

## Bekannte Restrisiken

- **REST ohne Login (E1):** Jeder lokale Prozess, also auch ein Agent mit Shell-Zugriff, kann
  die REST-API als „Mensch“ aufrufen und damit auch freigeben. Die Trennung zwischen Agent und
  Mensch gilt für das MCP-Protokoll, nicht gegenüber Prozessen mit Zugriff auf den Rechner.
  Für Netzwerk- oder Teambetrieb braucht es eine Anmeldung für Menschen (E2, nicht in v1).
- **`OPSIS_UNSAFE_BIND=1`** hebt die Loopback-Sperre auf. Es ist nur für einen Container
  gedacht, dessen Port ausschließlich auf `127.0.0.1` des Hosts veröffentlicht ist, oder für
  den Betrieb hinter einem Reverse Proxy, der selbst authentifiziert.
- **Abbruch von Wartevorgängen:** Mehrere Clients mit demselben Token und derselben
  JSON-RPC-ID können sich gegenseitig einen Wartevorgang abbrechen (siehe 06). Das betrifft
  nur die eigenen Aufrufe eines Agenten.
- **Kein Rate-Limit** auf `/mcp`. Bei 256-Bit-Tokens ist Raten aussichtslos. Lokal ist eine
  Überlastung kein relevantes Szenario.
- **Prompt-Inhalte:** Beschreibungen von Agenten und Menschen landen im
  Implementierungs-Prompt. Ein Agent sollte den Prompt als Spezifikation behandeln, nicht als
  Anweisung an sich selbst, die über die Aufgabe hinausgeht.
