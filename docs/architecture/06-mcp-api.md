# 06 – MCP-Schnittstelle

## 1. Transport und SDK

- **SDK:** `@modelcontextprotocol/server` 2.x (stabile v2-Linie, Spec 2026-07-28) mit
  `createMcpHandler(factory)`. Gemountet wird über `toNodeHandler()` aus
  `@modelcontextprotocol/node` unter `POST/GET /mcp` im Fastify-Prozess.
  Laut SDK-Doku bedient derselbe Handler auch Clients mit 2025-er Protokollversion
  (zustandsloser Fallback). Eine eigene Protokollvariante gibt es nicht.
- **Transport:** Streamable HTTP. Begründung: Ein einzelner langlebiger Serverprozess muss
  sowohl den Browser als auch Agenten bedienen und den Wartezustand teilen. stdio würde
  pro Agent einen eigenen Prozess starten, der keinen Zugriff auf den EventBus der UI hätte.
  Claude Code (`"type": "http"` in `.mcp.json`) und andere aktuelle Clients unterstützen HTTP.
  Ein optionaler stdio-Proxy kann später ergänzt werden (E5).
- **Schutz:** Host- und Origin-Validierung (`localhostHostValidation`/`originValidation`
  aus dem SDK) und `Authorization: Bearer <agent-token>`. Das daraus aufgelöste `authInfo`
  wird an die Server-Factory übergeben, jede Anfrage bekommt so ihren Akteur.
- **MCP-Tasks:** Die Anforderung verlangt, deren Einsatz zu prüfen. Ergebnis: Das SDK v2
  führt Tasks ausdrücklich nur noch als Wire-Vokabular der Spec 2025-11-25 „ohne
  SDK-Runtime“ (`TaskRequestMethod` ist von der typisierten API ausgeschlossen). Wir nutzen
  sie deshalb **nicht**. Stattdessen gibt es einen begrenzten Long-Poll mit
  Progress-Notifications, Wiederaufnahme per `session_id` und Resource-Update-Notifications.

Konfigurationsbeispiel für Claude Code:

```json
{
  "mcpServers": {
    "opsis": {
      "type": "http",
      "url": "http://127.0.0.1:4777/mcp",
      "headers": { "Authorization": "Bearer ${OPSIS_TOKEN}" }
    }
  }
}
```

## 2. Tool-Namen

Die Anforderung nennt `opsis.list_projects` usw. Laut MCP-Spec sind Punkte in Tool-Namen
zulässig, manche Clients (u. a. Funktionsaufruf-APIs mancher LLM-Anbieter) erlauben aber
nur `[a-zA-Z0-9_-]`. Wir registrieren deshalb **`opsis_list_projects`** usw. Der
Namensraum entsteht ohnehin durch den Servernamen. → E4, entschieden am 2026-11-07.

## 3. Tools

Alle Tools haben Zod-`inputSchema` und `outputSchema` und liefern `structuredContent`
plus eine kurze Textzusammenfassung. Fehler kommen als `isError: true` mit maschinenlesbarem
`code` (`NOT_FOUND`, `VALIDATION`, `INVALID_TRANSITION`, `NOT_READY`, `PAYLOAD_TOO_LARGE`,
`UNSUPPORTED_MEDIA`). Die Tool-Annotations (`readOnlyHint`, `idempotentHint`) sind gesetzt.

### Projekte

| Tool                   | Eingabe                                      | Ausgabe                                        |
| ---------------------- | -------------------------------------------- | ---------------------------------------------- |
| `opsis_list_projects`  | `cursor?`                                    | `{ projects[], nextCursor? }` (nur mit Grant)  |
| `opsis_get_project`    | `project_id`                                 | Projekt + Anzahl UIs/offene Sessions           |
| `opsis_create_project` | `name, slug?, description?, metadata?`       | Projekt (Grant für den Aufrufer wird angelegt) |
| `opsis_update_project` | `project_id, name?, description?, metadata?` | Projekt                                        |

### UI-Ansichten

| Tool                   | Eingabe                                        | Ausgabe                                                                                 |
| ---------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `opsis_list_ui_views`  | `project_id`                                   | `{ ui_views[{ui_id, path, name, head_version_no}] }`                                    |
| `opsis_get_ui_view`    | `project_id, ui_id`                            | Identität, Pfadhistorie, Versionsliste (kurz), offene Sessions                          |
| `opsis_create_ui_view` | `project_id, ui_id?, path, name, description?` | UiView                                                                                  |
| `opsis_get_ui_history` | `project_id, ui_id`                            | Versionen mit Screenshot-, SpecRevision- und Prompt-IDs, Änderungsbeschreibung, Session |

### Screenshots

| Tool                      | Eingabe                                                                                                                                                                  | Ausgabe                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `opsis_submit_screenshot` | `project_id, ui_id?, ui_id_hint?, ui_path, image_base64, mime_type, viewport_width, viewport_height, device_type, description, session_id?, agent_session_ref?, intent?` | `{ session_id, screenshot_id, ui_id, status, assignment, editor_url }`                     |
| `opsis_request_upload`    | dieselben Metadaten ohne Bild                                                                                                                                            | `{ session_id, upload_url, expires_at }` (für große Bilder, Einmal-Token, `PUT` per HTTP)  |
| `opsis_get_screenshot`    | `screenshot_id`                                                                                                                                                          | Metadaten + Session-Status. Optional `include_image`: liefert ein `ImageContent`-Thumbnail |
| `opsis_list_screenshots`  | `project_id, ui_id?`                                                                                                                                                     | Liste                                                                                      |

Mit `session_id` hängt `submit_screenshot` einen weiteren Screenshot (z. B. die
Mobile-Variante) an eine **offene** Session an. Es wird keine neue Session erzeugt.

`image_base64` ist auf 20 MB dekodiert begrenzt. Die Prüfung folgt 01 §6. Dieselbe
Validierungsfunktion wie beim Browser-Upload wird verwendet.

### Spezifikationsworkflow

| Tool                              | Eingabe                                             | Ausgabe                                                                                                           |
| --------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `opsis_get_session`               | `session_id`                                        | vollständige Session inkl. Screenshots, Basisversion, Status-Historie                                             |
| `opsis_get_session_status`        | `session_id`                                        | `{ status, assignment, updated_at, result_version_id?, next_action }`                                             |
| `opsis_wait_for_specification`    | `session_id, timeout_seconds (1–600, Standard 120)` | `{ done: bool, status, waited_seconds, resume: { tool, arguments } }`                                             |
| `opsis_get_specification`         | `session_id` _oder_ `version_id`, `format: json     | markdown`                                                                                                         | Spezifikation + Referenzen (UiVersion, SpecRevision, Screenshot-IDs) |
| `opsis_get_implementation_prompt` | `session_id` _oder_ `version_id`                    | `{ markdown, ui_version_id, version_no, spec_revision_id, prompt_version_id }`. Erster Abruf: `ready → delivered` |
| `opsis_cancel_session`            | `session_id, reason`                                | Session (nur eigene)                                                                                              |

Es gibt **kein** Tool zur Freigabe und keins zum Ändern von Komponenten. Die
Spezifikation erstellt und verantwortet allein der Mensch.

`get_specification` und `get_implementation_prompt` liefern vor `ready` den Fehler
`NOT_READY` zusammen mit dem aktuellen Status. Ein unfertiger Stand wird nie herausgegeben.

### Wartemechanismus im Detail

```
wait_for_specification(session_id, timeout)
  1. Zugriff prüfen, Status lesen → bereits ready/delivered/cancelled/failed? sofort zurück.
  2. EventBus abonnieren (SessionStatusChanged für session_id) – VOR einem zweiten
     Status-Read, damit kein Ereignis zwischen Lesen und Abonnieren verloren geht.
  3. Warten auf: Ereignis | timeout | Abbruch des Requests (AbortSignal → aufräumen).
     Alle 15 s: Progress-Notification (falls progressToken), die Client-Timeouts zurücksetzen kann
     und den Menschen-Status meldet ("in_progress: 4 Komponenten").
     Zusätzlich DB-Poll alle 5 s als Absicherung gegen verlorene Events.
  4. Ergebnis: done=true bei ready (bzw. delivered, cancelled, failed als terminaler Status).
     Bei Timeout: done=false, aktueller Status + resume-Hinweis. Kein Fehler.
```

Das Warten blockiert nie unbegrenzt. Der Agent kann es beliebig oft wiederholen, auch aus
einer neuen Konversation heraus, denn der gesamte Zustand liegt in der Datenbank.

### Umsetzung (Phase 5, Schritt 2)

- `/mcp` (GET/POST/DELETE) mountet `createMcpHandler` über `toNodeHandler` im Fastify-Prozess.
  Pro Anfrage: Host-Guard → Origin-Prüfung (fremdes `Origin` → 403) → `requireAgent`
  (Bearer, sonst 401) → `McpServer` aus der Factory, gebunden an diesen Agenten. Das Token
  selbst wird nicht an die Tools weitergereicht.
- Body-Limit von `/mcp`: ein base64-Bild der Maximalgröße plus 1 MB. Das dekodierte Bild ist
  wie beim Upload auf 20 MB begrenzt, es gilt dieselbe Prüfung (Magic Bytes, Dekodierung).
- Ausgaben in snake_case mit sprechenden IDs (`project_id`, `session_id`, `ui_id` statt
  interner UI-View-ID). `editor_url` zeigt auf `<OPSIS_PUBLIC_URL>/sessions/<id>`
  (Standard aus Host und Port).
- Fehler: `isError: true`, Text-Inhalt `{"error":{"code","message","details?"}}`.
- Abweichungen von der Tabelle: `intent` ist keine Eingabe, er ergibt sich aus dem Head der
  UI (`create`/`revise`). `mime_type` ist optional und nur informativ, maßgeblich ist der
  Inhalt. Zusätzlich gibt es `variant_label` und `title`. `get_screenshot` mit
  `include_image` liefert ein WebP-Thumbnail (längere Kante ≤ 1568 px).
- Ressourcen siehe Schritt 4 (§4), `opsis_request_upload` siehe Schritt 5 (unten).

### Umsetzung des zweistufigen Uploads (Phase 5, Schritt 5)

- `opsis_request_upload` nimmt dieselben Metadaten wie `opsis_submit_screenshot`, aber kein
  Bild. Es legt die Session an (Status `uploading`) oder bezieht sich auf eine offene
  Session (`session_id`, Variante) und liefert `{ session_id, ui_id, status, upload_url,
method: "PUT", expires_at, max_bytes, editor_url }`.
- `upload_url` = `<public_url>/api/v1/uploads/opsisupl_…`. Der Token ist einmalig, 15 Minuten
  gültig, und nur sein SHA-256 wird gespeichert (Tabelle `upload_slots`). Der Token ist die
  Autorisierung; ein Bearer-Header ist nicht nötig. In Request-Logs erscheint die URL als
  `/api/v1/uploads/[redacted]`.
- `PUT` mit dem rohen Bild als Body (`image/png|jpeg|webp` oder
  `application/octet-stream`, max. 20 MB) liefert `201 { session_id, screenshot_id, ui_id,
status }`. Das Format bestimmt der Inhalt. Ein abgelehntes Bild lässt den Slot offen.
  Unbekannte, verbrauchte oder abgelaufene Tokens ergeben einheitlich 404.
- Beim Hochladen gilt weiterhin der Zugriff des anfragenden Agenten: Ist er widerrufen oder
  hat er die Projektfreigabe verloren, schlägt der Upload fehl (404).
- Abgelaufene Slots werden minütlich (und beim nächsten Upload-Versuch) auf `expired`
  gesetzt; eine noch wartende Session geht nach `failed` (Notiz „upload slot expired“).

### Umsetzung des Wartens (Phase 5, Schritt 3)

- `waitForSpecification` im Core (unabhängig vom MCP-Adapter) läuft wie oben beschrieben:
  Zugriff prüfen, abonnieren, erneut lesen, warten. Es endet bei `ready`, `delivered`,
  `cancelled` oder `failed`, nach dem Timeout (`done: false` plus `resume`, kein Fehler) oder
  bei einem Abbruch. In jedem Fall werden Abonnement und Timer aufgeräumt.
- Progress-Notifications alle 15 s (nur mit `progressToken`), Text z. B.
  `in_progress: 4 components`. Ein fehlschlagender Progress beendet das Warten nicht.
- **Abbruch:** Clients mit Protokoll 2025 (zustandsloser Fallback) senden
  `notifications/cancelled` als eigenen POST, der bei einer anderen Serverinstanz ankommt.
  Der `/mcp`-Endpunkt hält deshalb je Agent und JSON-RPC-ID ein Abort-Handle laufender
  `tools/call`-Anfragen. Ein solcher Abbruch beendet das Warten, ebenso eine geschlossene
  Verbindung. Ein Agent kann nur seine eigenen Aufrufe abbrechen. Laufen mehrere Clients
  mit demselben Token und derselben Request-ID gleichzeitig, kann ein Abbruch den falschen
  Wartevorgang beenden; der Agent ruft dann einfach erneut `wait` auf.

## 4. Ressourcen

| URI-Template                                                     | Inhalt                                         | MIME             |
| ---------------------------------------------------------------- | ---------------------------------------------- | ---------------- |
| `opsis://projects/{project_id}`                                  | Projekt                                        | application/json |
| `opsis://projects/{project_id}/ui/{ui_id}`                       | UiView + Pfadhistorie                          | application/json |
| `opsis://projects/{project_id}/ui/{ui_id}/history`               | Versionsliste                                  | application/json |
| `opsis://projects/{project_id}/ui/{ui_id}/versions/{version_no}` | vollständige historische Rekonstruktion (JSON) | application/json |
| `opsis://sessions/{session_id}`                                  | Session + Status                               | application/json |
| `opsis://sessions/{session_id}/specification`                    | Spezifikation (erst ab `ready`)                | application/json |
| `opsis://sessions/{session_id}/prompt`                           | Prompt (erst ab `ready`)                       | text/markdown    |
| `opsis://screenshots/{screenshot_id}`                            | Bild                                           | image/png        | jpeg | webp (Blob) |

Die Ressourcen werden mit `ResourceTemplate` registriert. `list` liefert nur autorisierte
Einträge, jeder `read` läuft über dieselbe `AccessPolicy`. Bei Statuswechseln sendet der
Server `notifications/resources/updated` für `opsis://sessions/{id}` an abonnierte Clients
(`sendResourceUpdated`). Das ist ein zusätzlicher Benachrichtigungsweg. Der Long-Poll
funktioniert auch ohne ihn.

### Umsetzung (Phase 5, Schritt 4)

- Alle acht Templates sind registriert; jeder `read` läuft über dieselben Use-Cases wie die
  Tools. `list` liefert Projekte, UI-Ansichten und **offene** Sessions der freigegebenen
  Projekte; die übrigen Templates haben keine Auflistung.
- Fremde oder unbekannte IDs ergeben „resource not found“ (`-32602` mit `data: { uri }`),
  andere Domänenfehler einen JSON-RPC-Fehler mit dem Code im Text (z. B. `NOT_READY: …`).
- Das Lesen von `opsis://sessions/{id}/prompt` zählt wie das Tool als Auslieferung (E3).
- Benachrichtigungen: Domain-Events werden auf Ressourcen-URIs abgebildet
  (`SessionStatusChanged` → Session, bei `ready` auch Spezifikation und Prompt;
  `UiVersionCreated` → History; `ProjectChanged`, `UiViewChanged`, `SessionChanged`) und
  über `handler.notify.resourceUpdated` veröffentlicht. Zugestellt werden sie an
  `subscriptions/listen`-Streams von Clients mit Protokoll 2026-07-28; nur für diese wird
  `resources.subscribe` angekündigt. Der zustandslose 2025-Fallback hat keinen
  langlebigen Stream; dort bleibt der Long-Poll der Weg. Eine Benachrichtigung enthält nur
  die URI, der Inhalt ist weiterhin nur mit Zugriff lesbar.

## 5. Typischer Agentenablauf

```
opsis_list_projects → (opsis_create_project)
opsis_submit_screenshot { project_id, ui_path:"/dashboard", image_base64, … }
   → { session_id: "ses_01J…", ui_id:"ui-dashboard", status:"awaiting_review",
       editor_url:"http://127.0.0.1:4777/s/ses_01J…" }
Agent teilt dem Menschen den editor_url mit.
loop: opsis_wait_for_specification { session_id, timeout_seconds: 300 } until done
opsis_get_implementation_prompt { session_id } → Markdown mit V-Nr., Revision, Screenshot-Refs
```

Ein Beispiel-Skill bzw. eine CLAUDE.md-Vorlage für diesen Ablauf wird in Phase 6
mitgeliefert.
