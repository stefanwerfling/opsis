# OPSIS für Agenten (MCP)

OPSIS stellt einen MCP-Server über Streamable HTTP unter `/mcp` bereit. Ein Agent reicht
Screenshots ein, ein Mensch spezifiziert im Browser, der Agent erhält einen freigegebenen
Implementierungs-Prompt. Agenten können Spezifikationen **weder bearbeiten noch freigeben**.
Das macht immer der Mensch.

Die vollständige Schnittstellenbeschreibung mit Begründungen steht in
[architecture/06-mcp-api.md](architecture/06-mcp-api.md). Diese Seite ist die Kurzreferenz.

## 1. Agent anlegen und verbinden

Im Web-UI unter **Agenten** oder per CLI:

```sh
npx opsis agent create --name claude-code --project shop   # Projekt-ID oder Slug
```

Das Token (`opsis_…`) wird **einmal** angezeigt; gespeichert wird nur sein Hash. Der Agent
sieht ausschließlich die freigegebenen Projekte. Projekte, die er selbst anlegt, werden ihm
automatisch freigegeben.

`.mcp.json` im Projekt des Agenten (Claude Code):

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

Das Token gehört in die Umgebung (`export OPSIS_TOKEN=opsis_…`), nicht in die Versionskontrolle.

## 2. Ablauf

```
opsis_list_projects                      → Projekt wählen (oder opsis_create_project)
opsis_submit_screenshot                  → { session_id, editor_url, status: "awaiting_review" }
   Agent gibt dem Menschen den editor_url.
opsis_wait_for_specification             → wiederholen, bis done = true
opsis_get_implementation_prompt          → Markdown; die Session wird "delivered"
```

`opsis_wait_for_specification` wartet höchstens `timeout_seconds` (1–600, Standard 120).
Bei einem Timeout liefert es `done: false` und **keinen Fehler**; dann einfach erneut aufrufen.
Mit `progressToken` kommt alle 15 s eine Fortschrittsmeldung, z. B. `in_progress: 4 components`.
Jedes Ergebnis enthält `next_action` mit dem nächsten sinnvollen Schritt.

**Session-Status:** `created → uploading → awaiting_review → in_progress → ready → delivered`,
außerdem `cancelled` und `failed`. Der erste Abruf des Prompts durch den Agenten setzt
`delivered` (E3). Spätere Abrufe liefern denselben Prompt.

## 3. Tools

| Tool                              | Art        | Eingabe (`?` = optional)                                        | Ergebnis                                                                           |
| --------------------------------- | ---------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `opsis_list_projects`             | lesen      | `cursor?`                                                       | `projects, next_cursor`                                                            |
| `opsis_get_project`               | lesen      | `project_id`                                                    | `project, ui_view_count, open_session_count`                                       |
| `opsis_create_project`            | schreiben  | `name, slug?, description?, prompt_language?, metadata?`        | `project`                                                                          |
| `opsis_update_project`            | schreiben  | `project_id, name?, description?, prompt_language?, metadata?`  | `project`                                                                          |
| `opsis_list_ui_views`             | lesen      | `project_id`                                                    | `ui_views`                                                                         |
| `opsis_get_ui_view`               | lesen      | `project_id, ui_id`                                             | `ui_view, path_history, versions, open_sessions`                                   |
| `opsis_create_ui_view`            | schreiben  | `project_id, path, ui_id?, name?, description?`                 | `ui_view`                                                                          |
| `opsis_get_ui_history`            | lesen      | `project_id, ui_id`                                             | `ui_id, versions`                                                                  |
| `opsis_submit_screenshot`         | schreiben  | `project_id, image_base64` + Metadaten (s. u.)                  | `session_id, screenshot_id, ui_id, status, assignment, editor_url, …`              |
| `opsis_request_upload`            | schreiben  | `project_id` + Metadaten (s. u.)                                | `session_id, ui_id, status, upload_url, method, expires_at, max_bytes, editor_url` |
| `opsis_get_screenshot`            | lesen      | `screenshot_id, include_image?`                                 | `screenshot, session_status` (+ WebP-Vorschau)                                     |
| `opsis_list_screenshots`          | lesen      | `project_id, ui_id?`                                            | `screenshots`                                                                      |
| `opsis_get_session`               | lesen      | `session_id`                                                    | `session, screenshots, status_history, next_action`                                |
| `opsis_get_session_status`        | lesen      | `session_id`                                                    | `status, assignment, updated_at, result_version_id, next_action`                   |
| `opsis_wait_for_specification`    | lesen      | `session_id, timeout_seconds?`                                  | `done, status, waited_seconds, next_action, resume`                                |
| `opsis_get_specification`         | lesen      | `session_id?` oder `version_id?`, `format?` (`json`/`markdown`) | `format, specification, references`                                                |
| `opsis_get_implementation_prompt` | schreiben¹ | `session_id?` oder `version_id?`                                | `markdown, ui_version_id, version_no, spec_revision_id, prompt_version_id`         |
| `opsis_cancel_session`            | schreiben  | `session_id, reason`                                            | `session`                                                                          |

¹ Der erste Abruf markiert die Session als `delivered`.

**Metadaten eines Screenshots:** `ui_path` (z. B. `/dashboard`) oder `ui_id`; `ui_id_hint`,
`viewport_width`, `viewport_height`, `device_type`, `variant_label` (z. B. „dark mode“),
`description` (was zu sehen ist und was sich ändern soll), `title`, `agent_session_ref`.
Mit `session_id` wird ein weiterer Screenshot (Variante) an eine **offene** Session
angehängt. Das Bildformat (PNG, JPEG, WebP) wird aus dem Inhalt bestimmt; `mime_type` ist
nur informativ.

**Große Bilder (zweistufig):** `opsis_request_upload` liefert eine Einmal-URL, die 15 Minuten
gültig ist. Dorthin wird das rohe Bild hochgeladen:

```sh
curl -T screenshot.png -H 'content-type: image/png' "<upload_url>"
```

Bis dahin steht die Session auf `uploading`. Ein abgelaufener Slot setzt sie auf `failed`.

## 4. Ressourcen

| URI                                                              | Inhalt                                      |
| ---------------------------------------------------------------- | ------------------------------------------- |
| `opsis://projects/{project_id}`                                  | Projekt                                     |
| `opsis://projects/{project_id}/ui/{ui_id}`                       | UI-Ansicht + Pfadhistorie                   |
| `opsis://projects/{project_id}/ui/{ui_id}/history`               | freigegebene Versionen                      |
| `opsis://projects/{project_id}/ui/{ui_id}/versions/{version_no}` | Spezifikation einer Version (JSON)          |
| `opsis://sessions/{session_id}`                                  | Session + Status                            |
| `opsis://sessions/{session_id}/specification`                    | Spezifikation (ab `ready`)                  |
| `opsis://sessions/{session_id}/prompt`                           | Prompt (ab `ready`, zählt als Auslieferung) |
| `opsis://screenshots/{screenshot_id}`                            | Originalbild                                |

Clients mit Protokoll 2026-07-28 können Ressourcen abonnieren und erhalten
`notifications/resources/updated`. Ältere Clients nutzen `opsis_wait_for_specification`.

## 5. Fehler

Tool-Fehler kommen als `isError: true` mit dem Text `{"error":{"code","message","details?"}}`.

| Code                 | Bedeutung                                                           | Reaktion des Agenten                           |
| -------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `VALIDATION`         | Eingabe ungültig (`details.issues`)                                 | Eingabe korrigieren                            |
| `NOT_FOUND`          | Unbekannt **oder kein Zugriff**                                     | ID prüfen oder den Menschen um Freigabe bitten |
| `NOT_READY`          | Spezifikation oder Prompt noch nicht freigegeben                    | `opsis_wait_for_specification`                 |
| `INVALID_TRANSITION` | Session in falschem Status (z. B. Variante an geschlossene Session) | neue Session                                   |
| `CONFLICT`           | z. B. UI-ID bereits vergeben                                        | andere ID                                      |
| `PAYLOAD_TOO_LARGE`  | Bild zu groß (> 20 MB, > 16 384 px Kante, > 40 MP)                  | verkleinern                                    |
| `UNSUPPORTED_MEDIA`  | kein PNG, JPEG oder WebP                                            | konvertieren                                   |
| `FORBIDDEN_ACTOR`    | Aktion nur für Menschen                                             | –                                              |
| `INTERNAL`           | interner Fehler (Details nur im Server-Log)                         | später erneut versuchen                        |

HTTP-Ebene: `401` bei fehlendem, falschem oder widerrufenem Token; `403` bei fremdem
`Origin` oder `Host`.

Ein Beispiel für die Einbindung in Claude Code (Skill und CLAUDE.md-Abschnitt) liegt unter
[examples/claude-code](../examples/claude-code/).
