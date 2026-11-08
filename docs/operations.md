# Betrieb

## Voraussetzungen und Start

Node.js ≥ 24 (für `node:sqlite`). `sharp` bringt seine nativen Binärdateien selbst mit.

```sh
npm install
npm run build        # Server (tsc) und Web-UI (Vite)
npm start            # http://127.0.0.1:4777
```

Ohne gebautes Web-UI läuft nur die API, und das Log meldet `web UI not built`.

## Konfiguration (Umgebungsvariablen)

| Variable              | Standard            | Bedeutung                                                                                                       |
| --------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `OPSIS_HOST`          | `127.0.0.1`         | Bind-Adresse. Adressen außerhalb von Loopback nur mit `OPSIS_UNSAFE_BIND=1` (siehe [security.md](security.md)). |
| `OPSIS_PORT`          | `4777`              | Port                                                                                                            |
| `OPSIS_DATA_DIR`      | `./data`            | Datenbank und Bilder                                                                                            |
| `OPSIS_PUBLIC_URL`    | aus Host und Port   | Basis-URL in Links an Agenten (`editor_url`, `upload_url`)                                                      |
| `OPSIS_ALLOWED_HOSTS` | –                   | Weitere erlaubte `Host`-Namen, kommagetrennt (z. B. hinter einem Proxy)                                         |
| `OPSIS_LOG_LEVEL`     | `info`              | `fatal` … `trace`; Logs sind JSON (pino) auf stdout                                                             |
| `OPSIS_WEB_DIR`       | `packages/web/dist` | Verzeichnis des gebauten Web-UI                                                                                 |
| `OPSIS_UNSAFE_BIND`   | –                   | `1` erlaubt eine Bind-Adresse außerhalb von Loopback (kein Login!)                                              |

## CLI

```text
opsis [serve]                                   Server starten
opsis agent create --name <name> [--project <id|slug>]...
opsis agent list
opsis agent revoke <agent-id>
opsis agent grant <agent-id> <project-id|slug>
opsis agent ungrant <agent-id> <project-id|slug>
```

Aus dem Repository: `node packages/server/dist/cli.js agent list`. Die CLI arbeitet direkt auf
`OPSIS_DATA_DIR` und kann parallel zum laufenden Server benutzt werden. Per CLI angelegte
Agenten erscheinen im Web-UI erst nach dem Neuladen der Seite.

## Daten

```text
data/
  opsis.db, opsis.db-wal, opsis.db-shm   SQLite (WAL-Modus)
  blobs/ab/cd/<sha256>                    Bilder, inhaltsadressiert und unveränderlich
```

Migrationen laufen beim Start automatisch und in einer Transaktion. Freigegebene Versionen,
Prompts und Bilder werden nie verändert (Grundsatz: unveränderliche Historie).

**Sicherung:** Am einfachsten den Server stoppen und `data/` komplett kopieren. Im laufenden
Betrieb zuerst die Datenbank konsistent sichern, danach `blobs/` kopieren. Bilder sind
unveränderlich, eine Kopie nach der Datenbank ist also vollständig:

```sh
sqlite3 data/opsis.db ".backup 'backup/opsis.db'"
cp -r data/blobs backup/
```

Für einzelne Versionen gibt es den ZIP-Export im Web-UI (Version → Export), mit
Manifest und Hashes. Er lässt sich in ein anderes Projekt oder eine andere Installation
importieren.

## Beenden

`SIGINT`/`SIGTERM` schließen offene Verbindungen und die Datenbank sauber. Laufende
`opsis_wait_for_specification`-Aufrufe enden dabei. Agenten rufen sie nach dem Neustart
einfach erneut auf.

## Tests

```sh
npm run check        # tsc, ESLint, Prettier, Vitest (Unit-, Use-Case-, REST- und MCP-Tests)
npm run e2e          # Build + Playwright: Ende-zu-Ende-Ablauf und Performance-Messung
```

`npm run e2e` verwendet das installierte Google Chrome. Mit `OPSIS_E2E_CHANNEL=` (leer) und
`npx playwright install chromium` läuft es mit Playwrights eigenem Chromium. Die
Performance-Werte stehen danach in `test-results/perf.json`.

## Docker

```sh
docker build -t opsis .
docker run -d --name opsis \
  -p 127.0.0.1:4777:4777 \
  -v opsis-data:/data \
  opsis
docker exec opsis node packages/server/dist/cli.js agent create --name claude-code
```

Das Image (Node 24, Debian slim, ohne Dev-Abhängigkeiten) läuft als Benutzer `node` und
speichert alles im Volume `/data`. Es hat einen Health-Check auf `/api/v1/health`. Im
Container bindet der Server an `0.0.0.0` mit `OPSIS_UNSAFE_BIND=1`. Deshalb muss der Port
**nur auf `127.0.0.1` des Hosts** veröffentlicht werden (`-p 127.0.0.1:…`). Ein `-p 4777:4777`
würde OPSIS ohne Login im Netzwerk erreichbar machen (siehe [security.md](security.md)).
Bei einem anderen Host-Port `OPSIS_PUBLIC_URL` setzen, damit die Links an Agenten stimmen,
z. B. `-p 127.0.0.1:8080:4777 -e OPSIS_PUBLIC_URL=http://127.0.0.1:8080`.
