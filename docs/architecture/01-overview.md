# 01 – Architekturübersicht

Status: **Entwurf Phase 0** · Stand 2026-11-07

## 1. Ausgangslage (Bestandsaufnahme)

Das Repository ist leer bis auf `LICENSE` (MIT), `README.md` und ein generiertes `package.json`
(CommonJS, keine Abhängigkeiten). Es gibt keine bestehenden Technologieentscheidungen, die
berücksichtigt werden müssen. Laufzeitumgebung des Entwicklers: Node 24.21, npm 12.2, pnpm 11.2.

## 2. Systemkontext

```
 ┌──────────────┐  Streamable HTTP (MCP)   ┌───────────────────────────────────────┐
 │ KI-Agent     │ ───────────────────────► │ OPSIS-Server (ein Node-Prozess)       │
 │ Claude Code, │  Bearer-Token je Agent   │                                       │
 │ Codex, …     │ ◄─────────────────────── │  presentation:  /mcp   /api   /       │
 └──────────────┘  Progress / Resource-    │  application:   Use-Cases, EventBus   │
                   Notifications           │  domain:        Entitäten, Regeln     │
 ┌──────────────┐  REST/JSON + SSE         │  infrastructure: SQLite, Blob-Store,  │
 │ Mensch im    │ ───────────────────────► │                 Bildverarbeitung      │
 │ Browser      │ ◄─────────────────────── │                                       │
 │ (Editor)     │                          └──────────────┬────────────────────────┘
 └──────────────┘                                         │
                                               data/opsis.db (SQLite, WAL)
                                               data/blobs/ab/cd/<sha256>  (Bilder)
```

Ein Prozess bedient Web-UI, REST-API und MCP-Endpunkt. **Begründung:** Der Kernablauf
„Agent wartet, bis ein Mensch freigibt“ braucht eine gemeinsame Ereignisquelle. In einem
Prozess wird das ein In-Memory-EventBus, der die SQLite-Commits begleitet. Zwischen
Prozessen müssten wir eine IPC- oder Polling-Lösung erst erfinden. Mehrere Prozesse
bleiben trotzdem möglich (siehe Risiken R3).

## 3. Schichten und Pakete

npm-Workspaces, drei Pakete, keine weiteren Framework-Ebenen:

| Paket             | Schicht                                   | Inhalt                                                                                                                                        | Darf importieren                          |
| ----------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `packages/core`   | **Domain** (`src/domain`)                 | Entitäten, Value Objects, Statusmaschine, Diff-, Vollständigkeits- und Prompt-Logik als reine Funktionen                                      | nur `zod`                                 |
|                   | **Application** (`src/application`)       | Use-Cases (`SubmitScreenshot`, `ReleaseSpecification`, …), Ports (Repository- und BlobStore-Interfaces), `AccessPolicy`, `EventBus`-Interface | Domain                                    |
| `packages/server` | **Infrastructure** (`src/infrastructure`) | SQLite-Repositories, Migrationen, Blob-Store, `sharp`/`file-type`, ZIP, Logger                                                                | core                                      |
|                   | **Presentation** (`src/http`, `src/mcp`)  | Fastify-Routen, MCP-Tools/Ressourcen – beide nur dünne Adapter auf Use-Cases                                                                  | core, infrastructure                      |
|                   | Composition Root (`src/main.ts`)          | Verdrahtung, Konfiguration                                                                                                                    | alles                                     |
| `packages/web`    | **Presentation**                          | Web-Editor (Vanilla TypeScript, kein Framework)                                                                                               | core (nur Typen und Zod-Schemas, kein IO) |

Regel 4 der Architekturprinzipien („Geschäftslogik unabhängig von MCP und Frontend“) wird
technisch erzwungen. `packages/core` hat keine Abhängigkeit auf Fastify, MCP, SQLite oder Browser-APIs.
Eine ESLint-Regel (`no-restricted-imports`) prüft das zusätzlich.

**Bewusst nicht gemacht:** keine CQRS- oder Event-Sourcing-Infrastruktur, kein DI-Container,
kein generisches Repository. Use-Cases sind Funktionen bzw. kleine Klassen, die ihre Ports
per Konstruktor erhalten. Die Unveränderlichkeit der History liefern Snapshots plus
DB-Trigger (siehe 05), nicht Event-Sourcing.

## 4. Technologiestack (am 2026-11-07 gegen npm geprüft)

| Bereich       | Wahl                                                          | Version               | Begründung                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime       | Node.js                                                       | 24 LTS                | vorhanden, LTS                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Sprache       | TypeScript                                                    | **6.0.x** (nicht 7.0) | `typescript-eslint@8.72` verlangt `typescript >=4.8.4 <6.1.0`. Mit TS 7 wäre typisiertes Linting nicht möglich. Upgrade, sobald typescript-eslint TS 7 unterstützt.                                                                                                                                                                                                                                                                                                                   |
| Validierung   | zod                                                           | 4.x                   | wird auch vom MCP-SDK v2 verlangt (`zod ^4.2`). Dieselben Schemas für REST, MCP und Frontend.                                                                                                                                                                                                                                                                                                                                                                                         |
| HTTP          | Fastify                                                       | 5.x                   | schnell, Schema-Validierung, pino-Logging integriert, `@fastify/multipart` für Uploads mit Größenlimits                                                                                                                                                                                                                                                                                                                                                                               |
| MCP           | `@modelcontextprotocol/server` + `@modelcontextprotocol/node` | 2.4 / 2.1             | v2 ist laut README die stabile Linie und implementiert Spec 2026-07-28. `createMcpHandler(factory)` + `toNodeHandler()` lassen sich in Fastify mounten. Das v1-Paket `@modelcontextprotocol/sdk` wird nicht verwendet.                                                                                                                                                                                                                                                                |
| DB            | SQLite über das eingebaute `node:sqlite` (`DatabaseSync`)     | SQLite 3.53           | lokales Werkzeug ohne Betriebsaufwand, echte ACID-Transaktionen, synchrone API (Transaktionen ohne await-Fallen), Trigger für Unveränderlichkeit. Kein ORM: das Schema ist überschaubar, handgeschriebenes SQL plus Zod-Mapping bleibt nachvollziehbar. `node:sqlite` statt `better-sqlite3`, weil es ohne natives Modul auskommt und offizielle Typen hat. `better-sqlite3@13` liefert keine eigenen Typen mehr, und `@types/better-sqlite3` ist auf Stand 9.x (geprüft 2026-11-07). |
| Bilder        | `sharp` + `file-type`                                         | 0.35 / 22             | tatsächliches Format per Magic Bytes und Decoder prüfen, Maße auslesen, Thumbnails, annotierter Export (SVG-Overlay-Composite)                                                                                                                                                                                                                                                                                                                                                        |
| Bildvergleich | `pixelmatch`                                                  | 8.x                   | erzeugt eine Differenzmaske. OPSIS zeigt Unterschiede nur an und bewertet sie nicht.                                                                                                                                                                                                                                                                                                                                                                                                  |
| ZIP           | `yazl` / `yauzl`                                              | 3.x                   | Streaming, `yauzl` mit Validierung der Eintragsnamen (Zip-Slip-Schutz)                                                                                                                                                                                                                                                                                                                                                                                                                |
| Frontend      | Vanilla TypeScript + DOM, Vite 8 nur als Build-Werkzeug       | 8.x                   | Entscheidung 2026-11-08: kein UI-Framework, eigener Code. DOM nur über `h()` mit Textknoten (kein innerHTML), strenge CSP ohne Ausnahmen. Laufzeitwerte aus `@opsis/core/browser` (ohne zod).                                                                                                                                                                                                                                                                                         |
| Canvas        | eigener Canvas-2D-Code                                        | –                     | Zoom/Pan-Mathematik als reine, getestete Funktionen in `core/domain/geometry.ts`; Rendering mit `devicePixelRatio`.                                                                                                                                                                                                                                                                                                                                                                   |
| UI-State      | eigene „Live-Sections“                                        | –                     | laden, rendern, bei passenden SSE-Events neu laden; veraltete Antworten werden verworfen.                                                                                                                                                                                                                                                                                                                                                                                             |
| Tests         | Vitest 5, Playwright (E2E, Phase 6)                           |                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Qualität      | ESLint 10 + typescript-eslint 8, Prettier 3                   |                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Logs          | pino (über Fastify)                                           | 10                    | strukturierte JSON-Logs                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| IDs           | präfixierte ULIDs (`prj_01J…`)                                |                       | sortierbar und am Präfix als Typ erkennbar. Fachliche UI-ID ist davon getrennt (siehe 02).                                                                                                                                                                                                                                                                                                                                                                                            |

## 5. Kommunikationswege

- **Browser ↔ Server:** REST/JSON unter `/api/v1`, Bild-Upload als `multipart/form-data`.
  Live-Updates (z. B. „neue Session vom Agenten eingetroffen“) per Server-Sent Events unter
  `/api/v1/events`. SSE statt WebSocket, weil der Datenfluss nur vom Server zum Browser geht.
- **Agent ↔ Server:** MCP über Streamable HTTP unter `/mcp`. Tools rufen exakt dieselben
  Use-Cases auf wie die REST-Routen.
- **Intern:** Use-Cases publizieren nach dem Commit Domain-Events (`SessionStatusChanged`,
  `ScreenshotSubmitted`, …) auf den EventBus. SSE, MCP-Wartevorgänge und
  Resource-Notifications abonnieren ihn.

## 6. Sicherheitsgrundsätze

- Standardmäßig Bindung an `127.0.0.1`. Für Netzwerkbetrieb ist eine explizite Konfiguration
  mit Token-Pflicht nötig.
- Host- und Origin-Validierung vor `/mcp` (DNS-Rebinding-Schutz, Helfer aus dem SDK).
- Agenten authentifizieren sich mit Bearer-Token. Gespeichert wird nur `sha256(token)`.
  Projektzugriff über explizite Grants (siehe 04).
- Uploads: Größenlimit (Standard 20 MB, 16 384 px Kantenlänge, 40 MP, z. B. 2560×15 000), Whitelist
  PNG/JPEG/WebP, Magic-Byte-Prüfung **und** vollständiges Dekodieren mit `sharp`.
  Gespeichert wird unter einem inhaltsadressierten Pfad, der nie aus Benutzereingaben
  entsteht. Damit ist Path Traversal konstruktiv ausgeschlossen.
- Alle Eingaben laufen durch Zod-Schemas, für REST und MCP dieselben.
