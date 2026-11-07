# 04 – Session-Lifecycle, Agenten und Zugriffskontrolle

## 1. Zustandsautomat

```
            submit_screenshot (Metadaten)        Upload validiert & gespeichert
  ┌─────────┐  ──────────────►  ┌───────────┐  ─────────────────────────►  ┌─────────────────┐
  │ created │                   │ uploading │                              │ awaiting_review │
  └────┬────┘                   └─────┬─────┘                              └────────┬────────┘
       │ Fehler                       │ Fehler (Format, Größe, IO)                  │ Mensch öffnet/editiert
       ▼                              ▼                                             ▼
   ┌────────┐                     ┌────────┐                                 ┌─────────────┐
   │ failed │◄────────────────────┤ failed │                                 │ in_progress │◄──┐
   └────────┘                     └────────┘                                 └──────┬──────┘   │ Mensch öffnet
                                                                                    │ Mensch   │ wieder
                                                                                    │ gibt frei│ (nur vor
                                                                                    ▼          │ delivered)
                                                                             ┌─────────┐───────┘
                                                                             │  ready  │
                                                                             └────┬────┘
                                                                                  │ Agent ruft Prompt ab
                                                                                  ▼
                                                                            ┌───────────┐
                                                                            │ delivered │ (terminal)
                                                                            └───────────┘
  cancelled: erreichbar aus created, uploading, awaiting_review, in_progress, ready
             (terminal, nur durch den Menschen oder den besitzenden Agenten)
```

Erlaubte Übergänge stehen in **einer** Tabelle in `core/domain/session-status.ts`:

```ts
const TRANSITIONS = {
  created: ['uploading', 'failed', 'cancelled'],
  uploading: ['awaiting_review', 'failed', 'cancelled'],
  awaiting_review: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'cancelled'],
  ready: ['delivered', 'in_progress', 'cancelled'],
  delivered: [],
  cancelled: [],
  failed: [],
} as const;
```

Dazu kommen **Akteursregeln**, die ebenfalls zentral im Domain-Code liegen:

| Übergang                                | erlaubt für                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `in_progress → ready` (Freigabe)        | **nur Mensch**. Ein Agent kann nicht freigeben (Prinzip 10). Es gibt kein MCP-Tool dafür.                                |
| `ready → in_progress` (Wiedereröffnung) | nur Mensch                                                                                                               |
| `ready → delivered`                     | System, wenn ein autorisierter Agent `get_implementation_prompt` aufruft. Spätere Abrufe liefern dieselbe PromptVersion. |
| `* → cancelled`                         | Mensch, oder der Agent, der die Session erstellt hat                                                                     |

Jeder Übergang läuft in einer Transaktion. Er prüft `row_version` (optimistische Sperre),
schreibt `session_status_events` und `audit_log` und publiziert nach dem Commit
`SessionStatusChanged` auf den EventBus.

Hinweis zu `created/uploading`: Bei MCP mit Inline-Bild (Base64) laufen diese Zustände
innerhalb eines Tool-Aufrufs durch. Sie sind trotzdem real und werden protokolliert, denn
beim zweistufigen Upload (siehe 06, `request_upload`) bleibt eine Session sichtbar in
`uploading`, bis das Bild eintrifft. Läuft der Upload-Slot ab, geht die Session nach `failed`.

## 2. Parallele Sessions und Konflikte

- Beliebig viele Sessions pro Projekt und auch pro UiView sind erlaubt.
- Jede Session hat einen **eigenen Draft**. Sessions teilen keinen veränderlichen Zustand
  und können sich daher nicht gegenseitig überschreiben.
- Eine neue Session ändert niemals Status oder Daten einer anderen Session.
- **Konflikterkennung bei Freigabe:** Ist `uiView.headVersionId ≠ session.baseVersionId`
  (eine andere Session hat inzwischen eine Version erzeugt), wird die Freigabe zunächst
  abgelehnt (`409 VERSION_CONFLICT`). Der Editor zeigt dann den Diff zwischen der Basis
  und dem neuen Head und bietet zwei Wege an:
  1. **Auf neuen Head aufsetzen:** Die Basis der Session wird auf den Head gesetzt. Der
     Mensch prüft den Diff und gibt erneut frei. Der Prompt erhält dann den Hinweis
     „Basis aktualisiert von V3 auf V4“.
  2. **Trotzdem freigeben:** Die neue Version erhält `predecessor = Head` und den
     protokollierten Vermerk `based_on = V3, conflict_acknowledged`.

  Ein automatisches Zusammenführen von Drafts gibt es nicht.

- Schon beim Öffnen zeigt der Editor einen Hinweis, wenn für dieselbe UiView weitere offene
  Sessions existieren.

## 3. Zuordnungsunsicherheit (UI-ID / UI-Pfad)

`submit_screenshot` entscheidet deterministisch:

| Eingabe                                                 | Ergebnis                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui_id` existiert, `ui_path` fehlt oder stimmt überein  | Session auf dieser UiView, `assignment = confirmed`                                                                                                                             |
| `ui_id` existiert, `ui_path` weicht ab                  | Session auf dieser UiView, `assignment = needs_confirmation`, vorgeschlagene Pfadänderung im Draft. Der Mensch bestätigt die Pfadänderung oder verwirft sie.                    |
| keine `ui_id`, `ui_path` gehört bereits zu einer UiView | **kein** stilles Zusammenführen. Session auf dieser UiView mit `needs_confirmation`. Der Mensch bestätigt die Zuordnung oder legt eine neue UiView an.                          |
| keine `ui_id`, `ui_path` unbekannt                      | neue UiView. Die UI-ID kommt aus `ui_id_hint` oder wird aus dem Pfad abgeleitet (`/admin/users/:id` → `ui-admin-users-id`, bei Kollision mit Suffix). `assignment = confirmed`. |

Solange `assignment = needs_confirmation` gilt, ist die Freigabe blockiert
(siehe Vollständigkeitsbericht).

## 4. Agenten, Projekt- und Session-Zuordnung

- Ein Agent ist eine registrierte Identität mit Token. Angelegt wird er per CLI
  (`opsis agent create --name claude-code-laptop`) oder in der Web-UI. Das Token wird nur
  einmal angezeigt.
- Mehrere Agenten bzw. Entwicklungssitzungen können demselben Projekt zugeordnet sein:
  über Grants auf Projektebene, und je Session über `agent_id` plus frei wählbares
  `agent_session_ref`.
- `create_project` durch einen Agenten erzeugt automatisch einen Grant für diesen Agenten.
- **Zugriffsprüfung** erfolgt in der Application-Schicht (`AccessPolicy.assertProjectAccess(actor, projectId)`)
  und nicht im MCP-Adapter. Damit gilt sie für Tools, Ressourcen und künftige Schnittstellen gleichermaßen.
- Jede Abfrage über eine ID (Session, Screenshot, UI) prüft das zugehörige Projekt gegen
  die Grants. Eine fremde ID liefert `NOT_FOUND` statt `FORBIDDEN`, damit keine IDs
  erraten werden können.
- `list_projects` zeigt nur Projekte, für die ein Grant besteht.
- Der menschliche Benutzer der lokalen Web-UI hat in v1 Vollzugriff (offene Entscheidung E1).
