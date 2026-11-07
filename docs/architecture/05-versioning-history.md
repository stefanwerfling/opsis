# 05 – Versions- und History-Konzept

## 1. Grundsatz: veränderlicher Draft, unveränderlicher Snapshot

|          | Draft                                                            | Released                                                                                              |
| -------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ort      | `drafts`, `draft_components`, `draft_regions`, `draft_relations` | `spec_revisions`, `component_revisions`, `spec_revision_components`, `prompt_versions`, `ui_versions` |
| Änderbar | ja, solange die Session `awaiting_review` oder `in_progress` ist | **nie**, technisch per Trigger durchgesetzt                                                           |
| Zweck    | Arbeitsfläche des Menschen                                       | Historie, Rekonstruktion, Auslieferung an Agenten                                                     |

Varianten wie Event-Sourcing (jede Editor-Aktion als Event) oder ein Copy-on-write-Baum
wurden verworfen. Sie sind deutlich komplexer und bieten für die Anforderungen
(Rekonstruktion **freigegebener** Stände, Diff zwischen Versionen) keinen Mehrwert. Die
Nachvollziehbarkeit einzelner Draft-Änderungen leistet das `audit_log`.

## 2. Freigabe (eine Transaktion)

```
ReleaseSpecification(sessionId, actor=human, acknowledgedWarnings, changeDescription)
  1. Session im Status in_progress, rowVersion passt, actor ist Mensch
  2. report = assessCompleteness(draft) → blocking leer? warnings ⊆ acknowledged?
  3. Konfliktprüfung: uiView.head == session.base  (sonst VERSION_CONFLICT, siehe 04)
  4. für jede Komponente: content = canonicalJson({name, kind, spec, regions})
       → component_revisions (INSERT OR IGNORE über (component_id, sha256))
  5. spec_revisions (revision_no = max+1, snapshot = canonicalJson(gesamter Draft + Basisbezug))
  6. spec_revision_components (Baumstruktur: parent, order)
  7. markdown = generatePrompt(snapshot, previousSnapshot?, context) → prompt_versions
  8. ui_versions (version_no = max+1, predecessor = head, screenshot(s), path_at_version)
  9. ui_views.head_version_id = neue Version; session → ready, result_version_id
 10. audit_log; COMMIT; danach EventBus: SessionStatusChanged, UiVersionCreated
```

`canonicalJson` sortiert Schlüssel und normalisiert Zahlen. Gleicher Inhalt ergibt
dadurch gleichen Hash und so funktioniert die Deduplizierung der ComponentRevisions.

## 3. Überarbeitung einer bestehenden UI

Eine Session mit `intent = revise` (Standard, wenn die UiView bereits eine Version hat)
übernimmt beim Anlegen den Komponentenbaum der Basisversion **mit denselben
`componentId`s** in ihren Draft. Die Regionen beziehen sich zunächst auf den alten
Screenshot. Der Editor zeigt sie über dem neuen Screenshot an, und der Mensch passt sie an
oder bestätigt sie. Bestätigte Regionen werden auf den neuen Screenshot umgehängt.

Der Prompt einer Überarbeitung unterscheidet dann durch einen Vergleich mit der Basisversion:

- **Unverändert** (Komponente und Inhaltshash identisch),
- **Geändert** (feldgenauer Diff mit alt → neu),
- **Neu**, **Entfernt**,
- **Bestehende Anforderungen** (unveränderter Teil, gekürzt als Kontext).

## 4. Versionsvergleich

`compareVersions(a, b)` ist eine reine Funktion in `core/domain/diff.ts` und arbeitet auf
zwei Snapshots:

| Kategorie                                              | Erkennung                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Neu / entfernt                                         | `componentId` nur in b bzw. nur in a                                                           |
| Verschoben (Hierarchie)                                | `parentId` oder `order` geändert                                                               |
| Verschoben (Geometrie)                                 | Regionsmittelpunkt bei gleicher Geräteklasse verschoben (> 2 px, normiert auf Screenshotgröße) |
| Größe geändert                                         | Breite/Höhe der Region geändert                                                                |
| Beschreibung / Verhalten / Layout / Akzeptanzkriterien | feldgenauer Diff je Inspektor-Gruppe                                                           |
| Relationen                                             | hinzugefügt/entfernt/geändert                                                                  |
| Globale Angaben                                        | Ziel, Akzeptanzkriterien, offene Fragen                                                        |

**Visueller Vergleich:**

- Im Browser: Überlagerung beider Screenshots mit Transparenz-Regler, Wischmodus und
  Seite-an-Seite-Ansicht, jeweils optional mit den Komponentenrahmen beider Versionen.
- Auf dem Server: `pixelmatch`-Differenzmaske, wenn beide Bilder dieselben Maße haben.
  Andernfalls wird b für die Maske auf die Maße von a skaliert und die Abweichung der
  Seitenverhältnisse angezeigt.
- Das Ergebnis heißt ausdrücklich „erkannte Pixelunterschiede“. OPSIS markiert nichts als
  „beabsichtigt“ oder „Fehler“, die Bewertung liegt beim Menschen.

## 5. Komponentenhistorie

`SELECT … FROM spec_revision_components JOIN spec_revisions … WHERE component_id = ?`
liefert für jede Komponente die Liste ihrer Revisionen über alle Versionen. Ein Wechsel
der `component_revision_id` zwischen zwei Versionen bedeutet eine Änderung. Daraus
entsteht in der History-Ansicht die Zeitleiste je Komponente mit Diff.

## 6. Historische Rekonstruktion

`reconstructVersion(uiVersionId)` lädt:
UiVersion → Screenshot(s) (Blob) + SpecRevision.snapshot (Baum, Regionen, Beschreibungen,
Eigenschaften, Relationen, Konflikte, offene Fragen) + PromptVersion.markdown.

Alle Teile sind unveränderlich, das Ergebnis ist daher stabil. Der Editor öffnet einen
historischen Stand im **Nur-Lese-Modus**. „Als Basis für neue Session verwenden“ kopiert
ihn in einen neuen Draft (siehe §3).

## 7. Export / Import

| Format                 | Inhalt                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| JSON                   | `opsis-export/v1`: Projekt-, UI-, Versions-, SpecRevision- und Prompt-IDs, Snapshot, Screenshot-Metadaten |
| Markdown Spezifikation | lesbare Fassung des Snapshots                                                                             |
| Markdown Prompt        | `PromptVersion.markdown`                                                                                  |
| Screenshot original    | Blob                                                                                                      |
| Screenshot annotiert   | `sharp`-Composite aus Original und SVG-Overlay (Rahmen und Namen, Farbe nach Tiefe)                       |
| ZIP                    | `manifest.json` (Format-Version, IDs, sha256 je Datei) + alle obigen Dateien                              |

**Import** prüft die Formatversion, alle Hashes und die Schemas. Erlaubt sind nur bekannte
Pfade im ZIP, maximale Gesamtgröße und Anzahl der Einträge sind begrenzt. Importierte
Versionen werden als neue unveränderliche Datensätze angelegt. Original-IDs bleiben
erhalten, wenn sie im Zielsystem frei sind. Andernfalls entsteht ein Import-Mapping, das
im Audit-Log protokolliert wird (E6).
