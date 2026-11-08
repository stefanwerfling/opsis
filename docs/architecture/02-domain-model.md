# 02 – Domain-Modell

## 1. Überblick

```
Project 1───* UiView 1───* UiVersion (unveränderlich)
   │            │  │            │ ├─► Screenshot (primär)
   │            │  │            │ ├─► SpecRevision ──* ComponentRevision
   │            │  │            │ ├─► PromptVersion
   │            │  │            │ └─► UiVersion (Vorgänger)
   │            │  └─* UiPathChange
   │            └──* Session 1───1 Draft (veränderlich, solange Session offen)
   │                     │            └─* DraftComponent ─* Region (je Screenshot)
   │                     └──* Screenshot (unveränderlich)
   └──* AgentGrant *───1 Agent
```

**Leitgedanke:** Bearbeitet wird ausschließlich im **Draft** einer offenen Session.
Bei der Freigabe durch den Menschen entsteht ein unveränderlicher Satz aus
`SpecRevision + ComponentRevisions + PromptVersion + UiVersion`. Historische Stände werden
später nie verändert, sondern nur gelesen oder als Basis für einen neuen Draft kopiert.

## 2. Entitäten

### Project

`id (prj_…)`, `slug` (eindeutig), `name`, `description`, `promptLanguage` (`en|de`, Standard `en`),
`metadata` (freies JSON, validiert),
`createdAt`, `updatedAt`, `archivedAt?`.

### UiView – logische Oberfläche

| Feld                  | Bedeutung                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` (`uiv_…`)        | interne technische ID                                                                                                                                    |
| `uiId`                | **fachliche, dauerhafte UI-ID**, z. B. `ui-dashboard-main`. Eindeutig im Projekt, nach dem Anlegen unveränderlich. Format `^ui-[a-z0-9]+(-[a-z0-9]+)*$`. |
| `path`                | aktueller **UI-Pfad**, z. B. `/admin/users/:id`. Änderbar. Jede Änderung erzeugt einen `UiPathChange`.                                                   |
| `name`, `description` |                                                                                                                                                          |
| `headVersionId?`      | neueste `UiVersion`                                                                                                                                      |

Wichtige Regeln:

- Ändert sich der Pfad, bleibt die `uiId` gleich (Prinzip 5).
- OPSIS ordnet **niemals** über Dateinamen oder Bildähnlichkeit zu. `submit_screenshot`
  braucht entweder eine bekannte `ui_id` oder legt explizit eine neue UI an. Passt der
  übergebene `ui_path` zu einer **anderen** bestehenden UI, wird die Session mit
  `assignment = needs_confirmation` angelegt und der Mensch muss die Zuordnung bestätigen
  (siehe 04, „Zuordnungsunsicherheit“).

### Screenshot – unveränderliches Artefakt

`id (scr_…)`, `projectId`, `uiViewId?`, `sessionId?`, `blobSha256`, `mimeType`,
`width`/`height` (tatsächliche Pixelmaße), `viewportWidth`/`viewportHeight` (Angabe des
Agenten), `deviceCategory` (`desktop|tablet|mobile|other`), `variantLabel?`, `capturedAt`,
`source` (`mcp|upload|import`), `submittedBy` (Agent oder Mensch), `description`,
`sequenceNo` (fortlaufend je UiView, entspricht der geforderten „Versionsnummer“ des
Screenshots).

Ein Screenshot wird nie überschrieben. Ein „neuer Stand“ ist immer ein neuer Screenshot.

### Session – ein Spezifikationsauftrag

`id (ses_…)`, `projectId`, `uiViewId`, `agentId?`, `agentSessionRef?` (frei, z. B. die
Konversations-ID des Agenten), `intent` (`create|revise`), `title`, `status`
(siehe 04), `baseVersionId?` (UiVersion, auf der die Überarbeitung aufsetzt),
`assignment` (`confirmed|needs_confirmation`), `resultVersionId?`, `rowVersion`
(optimistische Sperre), Zeitstempel.

### Draft (gehört genau einer Session, veränderlich)

- `goal`, `changeSummary`, `globalAcceptanceCriteria[]`, `openQuestions[]`
- `components: DraftComponent[]`
- `relations: Relation[]` (`fromComponentId`, `toComponentId`, `kind`
  (`controls|navigates_to|data_flow|depends_on|other`), `description`)

### Component / DraftComponent

| Feld                    | Bedeutung                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `componentId` (`cmp_…`) | **stabile Identität über Versionen hinweg**. Wird eine Überarbeitung aus V3 gestartet, übernimmt der neue Draft die IDs. Nur so lassen sich „verschoben“ und „geändert“ von „entfernt + neu“ unterscheiden. |
| `parentId?`, `order`    | **semantische** Hierarchie, vom Benutzer festgelegt und nicht aus Geometrie abgeleitet                                                                                                                      |
| `name`, `kind`          | `kind`: `component                                                                                                                                                                                          | container | visual_area | interactive | group` |
| `hidden`                | nur Editor-Sichtbarkeit, hat keine fachliche Bedeutung                                                                                                                                                      |
| `regions[]`             | `{ screenshotId, x, y, width, height }` in **Pixeln des Original-Screenshots**. Eine Komponente kann je Darstellungsvariante (Desktop/Mobile) eine eigene Region haben oder auf einer Variante fehlen.      |
| `spec`                  | strukturierte Eigenschaften (siehe 3)                                                                                                                                                                       |

### Relation

Gerichtete Verknüpfung zwischen zwei Komponenten derselben Session.

### Draft-Operationen (Phase 2)

Alle Änderungen am Draft laufen über **eine** reine Funktion
`applyDraftOperations(draft, operations, context)` in `core/domain/draft.ts`. Server
(maßgeblich) und Browser (optimistische Anzeige) verwenden denselben Code. Ein Batch ist
atomar; ein Fehler nennt den Index der fehlgeschlagenen Operation.

| Operation                   | Regeln                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `addComponent`              | ID `cmp_…` vom Client (sofortige Anzeige), eindeutig; Eltern muss existieren; optional mit Region                                  |
| `updateComponent`           | Name (nicht leer, max. 200), Typ, Sichtbarkeit                                                                                     |
| `moveComponent`             | neuer Elternteil und Position; **Zyklusprüfung** (nicht in sich selbst oder Nachfahren)                                            |
| `duplicateComponent`        | kopiert den Teilbaum mit Regionen und Spezifikation; `idMap` muss genau den Teilbaum abdecken. Relationen werden nicht mitkopiert. |
| `deleteComponent`           | löscht den Teilbaum und alle Relationen, die ihn berühren                                                                          |
| `setRegion`                 | je Screenshot höchstens eine Region; nur Screenshots der Session; auf ganze Pixel gerundet und ins Bild geclampt                   |
| `setSpecValue`              | nur Gruppen/Felder aus `SPEC_GROUPS`; leerer Wert entfernt das Feld                                                                |
| `add/update/deleteRelation` | zwei verschiedene, existierende Komponenten                                                                                        |
| `updateDraft`               | Ziel, Änderungszusammenfassung, globale Akzeptanzkriterien, offene Fragen (Leerzeilen entfallen)                                   |

Speichern: `POST /api/v1/sessions/:id/draft/operations { baseRevision, operations }`.
`baseRevision` ≠ gespeicherte Revision → `409 VERSION_CONFLICT` (z. B. zweiter Browser-Tab).
Nur ein Mensch bearbeitet den Draft. Die erste Änderung einer Session in
`awaiting_review` startet die Prüfung (`→ in_progress`, Statusnotiz „first edit“).

### SpecRevision (unveränderlich)

`id (spr_…)`, `uiViewId`, `sessionId`, `revisionNo` (je UiView fortlaufend), `snapshot`
(kanonisches JSON des gesamten Drafts), `snapshotSha256`, `completeness` (Report zum
Freigabezeitpunkt), `acknowledgedIssues[]`, `releasedBy`, `releasedAt`,
`previousSpecRevisionId?`.

### ComponentRevision (unveränderlich, dedupliziert)

`id (cmr_…)`, `componentId`, `contentSha256`, `content`. Bleibt eine Komponente zwischen
zwei Versionen unverändert, verweisen beide SpecRevisions auf **dieselbe**
ComponentRevision. Damit ist die Änderungshistorie je Komponente direkt abfragbar.

### PromptVersion (unveränderlich)

`id (prm_…)`, `specRevisionId`, `generatorVersion`, `markdown`, `sha256`, `createdAt`.
Eine SpecRevision kann mehrere PromptVersions haben, z. B. nach einem Update des
Generators. Die UiVersion referenziert diejenige, die bei der Freigabe ausgeliefert wurde.

### UiVersion (unveränderlich)

`id (uiver_…)`, `projectId`, `uiViewId`, `versionNo` (V1, V2, …), `screenshotId`
(primär), `screenshotIds[]` (alle Varianten), `specRevisionId`, `promptVersionId`,
`sessionId`, `predecessorVersionId?`, `pathAtVersion`, `changeDescription`,
`createdBy`, `createdAt`.

### Agent, AgentGrant

`Agent { id (agt_…), name, tokenHash, createdAt, revokedAt? }`,
`AgentGrant { agentId, projectId, role: 'contributor' }`.

### AuditEntry

Jede schreibende Operation: `at, actorType (human|agent|system), actorId, projectId,
entityType, entityId, action, data`.

## 3. Spezifikation einer Komponente und Herkunft von Angaben

Die Inspektor-Bereiche aus der Anforderung (Abschnitt 6) werden zu festen Gruppen mit
genau den dort genannten Feldern (`core/domain/vocabulary.ts`, `SPEC_GROUPS`). „Name“ und
„Typ“ der Gruppe „Allgemein“ sind die Komponentenfelder `name` und `kind`.

| Gruppe        | Felder                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `general`     | `description`, `purpose`, `responsibility`                                                                  |
| `visual`      | `colors`, `sizes`, `spacing`, `positioning`, `typography`, `borders`, `shadows`, `responsive`               |
| `functional`  | `task`, `inputData`, `outputData`, `dataSources`, `actions`, `dependencies`                                 |
| `interaction` | `hover`, `click`, `focus`, `active`, `disabled`, `loading`, `error`, `success`, `keyboard`                  |
| `layout`      | `positioning`, `flexGrid`, `scrolling`, `overflow`, `sizing`, `parentRelation`                              |
| `acceptance`  | `expectedBehavior`, `expectedLayout`, `functionalRequirements`, `errorConditions`, `responsiveRequirements` |

Jeder Feldwert ist ein **`SpecValue`**:

```ts
type SpecValue = {
  value: string; // Freitext (mehrzeilig). Leerer Wert = Feld entfernt = „nicht spezifiziert“.
  origin: 'user' | 'screenshot_derived' | 'auto_detected';
  note?: string;
};
```

(Umgesetzt in Phase 2 mit `value: string` statt der ursprünglich skizzierten Listen- und
Map-Varianten: Alle Felder der Anforderung sind Beschreibungen. Strukturierte Werte können
später ergänzt werden, ohne bestehende Daten zu brechen.)

| Zustand                       | Darstellung                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Vom Benutzer vorgegeben**   | `origin: 'user'`                                                                                                      |
| **Aus Screenshot abgeleitet** | `origin: 'screenshot_derived'` (z. B. Maße aus der Region, erfasst vom Menschen)                                      |
| **Automatisch erkannt**       | `origin: 'auto_detected'` (z. B. Bilddiff, später ML-Vorschläge). Gilt bis zur Bestätigung **nicht** als Anforderung. |
| **Noch unbekannt**            | Feld fehlt. Es gibt keinen Default und keine Erfindung. Der Generator schreibt „nicht spezifiziert“.                  |
| **Widersprüchlich**           | `Conflict`-Eintrag (siehe unten)                                                                                      |

**Widersprüche** werden auf zwei Wegen erfasst:

1. Manuell: Der Benutzer markiert zwei Angaben als widersprüchlich.
2. Regelbasiert und deterministisch durch den Domain-Validator, z. B.:
   - Kind ist laut Layout `contained`, liegt aber geometrisch außerhalb der Region des Elternteils.
   - `interaction.disabled` beschreibt ein Verhalten bei einem Element mit `kind: visual_area`.
   - Zwei Akzeptanzkriterien derselben Komponente sind als sich ausschließend markiert.
   - Eine Relation verweist auf eine gelöschte Komponente.

   Die Regeln liefern **Hinweise**. Ob tatsächlich ein Widerspruch vorliegt, entscheidet der Mensch.

## 4. Vollständigkeitsbericht (`CompletenessReport`)

Ein reine Funktion `assessCompleteness(draft) → { blocking[], warnings[], unknownFields[] }`.

- **blocking**: keine Komponente, keine Zuordnung bestätigt, ungelöste Konflikte, Relation
  ins Leere, Komponente ohne Name.
- **warnings**: Komponente ohne Beschreibung oder ohne Akzeptanzkriterium,
  `auto_detected`-Werte nicht bestätigt, offene Fragen vorhanden.

Freigabe ist möglich, wenn `blocking` leer ist **und** der Mensch alle `warnings` explizit
bestätigt („mit offenen Punkten freigeben“). Die bestätigten Punkte landen in der
SpecRevision und als Abschnitt „Offene Fragen und Einschränkungen“ im Prompt.
Unvollständige Stände werden so nie stillschweigend als vollständig ausgegeben.
