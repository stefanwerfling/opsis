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

Umsetzung (Phase 3, `core/application/release.ts`):

- Abgelehnt wird mit `INCOMPLETE` (HTTP 422); die Details enthalten `blocking` und
  `unacknowledgedWarnings`. Nur Bestätigungen, die zu einer tatsächlichen Warnung gehören,
  werden gespeichert.
- Der Snapshot enthält keine Versions-IDs, Nummern oder Zeitstempel der Freigabe. Diese
  Referenzen bekommen Prompt und Spezifikations-JSON getrennt. Die Spezifikation
  (JSON/Markdown) wird jederzeit deterministisch aus dem gespeicherten Snapshot erzeugt; der
  Prompt ist als `PromptVersion` gespeichert und wird unverändert ausgeliefert.
- **Wiedereröffnen** (`ready → in_progress`, nur vor `delivered`) setzt
  `baseVersionId` auf die eigene freigegebene Version. Die nächste Freigabe erzeugt
  V(n+1) mit dieser Version als Vorgänger; die frühere Version bleibt unverändert.
- Den Abruf des Prompts durch einen **Agenten** (über Session oder Version) wertet OPSIS als
  Auslieferung (`ready → delivered`, E3). Liest der Mensch den Prompt in der Web-UI, ändert
  das den Status nicht.

`canonicalJson` sortiert Schlüssel und normalisiert Zahlen. Gleicher Inhalt ergibt
dadurch gleichen Hash und so funktioniert die Deduplizierung der ComponentRevisions.

## 3. Überarbeitung einer bestehenden UI

Eine Session mit `intent = revise` (Standard, wenn die UiView bereits eine Version hat)
übernimmt beim Anlegen den Komponentenbaum der Basisversion **mit denselben
`componentId`s** in ihren Draft. Die Regionen beziehen sich zunächst auf den alten
Screenshot. Der Editor zeigt sie über dem neuen Screenshot an, und der Mensch passt sie an
oder bestätigt sie. Bestätigte Regionen werden auf den neuen Screenshot umgehängt.

Umsetzung (Phase 4, `core/domain/revision.ts`): Übernommen werden Komponenten (Baum,
Name, Typ, Spezifikation, Regionen), Relationen, Ziel, globale Akzeptanzkriterien und
offene Fragen. Nicht übernommen werden die Änderungszusammenfassung und die (aufgelösten)
Widersprüche; diese bleiben in der Basisversion nachvollziehbar. Eine Region auf einem
Screenshot außerhalb der Session blockiert die Freigabe (`inherited_region`). Der Editor
zeigt dazu gestrichelt einen Vorschlag auf dem aktiven Screenshot, skaliert über das
Breitenverhältnis und auf das Bild begrenzt. „Übernehmen“ setzt die Region dort und
entfernt die geerbte, einzeln oder für alle auf einmal.

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

Umsetzung (Phase 4): `compareVersions` liefert je Komponente den Status `added`,
`removed`, `changed` oder `unchanged` mit Umbenennung, Typwechsel, neuem Elternteil,
Reihenfolge (relativ zu den Geschwistern, die in beiden Versionen existieren, damit ein
gelöschtes Geschwister keine Scheinänderungen erzeugt), Geometrie je Geräteklasse
(Toleranz 2 px, Region aus a über das Breitenverhältnis auf b skaliert) und feldgenauen
Änderungen. Hinzu kommen Relationen, Ziel, globale Akzeptanzkriterien und offene Fragen.
REST: `GET /api/v1/versions/:a/compare/:b`.

Der Prompt einer Version mit Vorgänger beginnt nach dem Ziel mit „Änderungen gegenüber
V(n)“ (Generator `opsis-prompt/1.1.0`). Verglichen wird mit dem **Vorgänger** (dem Head bei
der Freigabe), denn diesen Stand hat der Agent umgesetzt. Die vollständige Spezifikation
folgt weiterhin, der Prompt bleibt eigenständig.

**Visueller Vergleich:**

- Im Browser: Überlagerung beider Screenshots mit Transparenz-Regler, Wischmodus und
  Seite-an-Seite-Ansicht, jeweils optional mit den Komponentenrahmen beider Versionen.
- Auf dem Server: `pixelmatch`-Differenzmaske, wenn beide Bilder dieselben Maße haben.
  Andernfalls wird b für die Maske auf die Maße von a skaliert und die Abweichung der
  Seitenverhältnisse angezeigt.
- Das Ergebnis heißt ausdrücklich „erkannte Pixelunterschiede“. OPSIS markiert nichts als
  „beabsichtigt“ oder „Fehler“, die Bewertung liegt beim Menschen.

Umsetzung (Phase 4): Die Ansicht `/projects/:pid/ui/:uiId/history` zeigt die Zeitleiste,
zwei Versionsauswahlen (Standard: neueste Version und Vorgänger), die Modi Überlagerung
(Deckkraft), Wischen (Trennlinie), Seite an Seite (jeweils mit Komponentenrahmen als SVG,
A gestrichelt, B durchgezogen; B in der Breite von A) und Pixelunterschiede. Darunter
stehen die Komponentenänderungen feldgenau mit dem Verlauf jeder Komponente. Die
Pixeldifferenz liefert `GET /api/v1/versions/:a/pixel-diff/:b` als PNG; die Kennzahlen
stehen in `x-opsis-*`-Headern. Sehr große Screenshots werden vorher auf höchstens 12 MPx
verkleinert. Verglichen werden die primären Screenshots, optional andere über
`?screenshotA=`/`?screenshotB=`. Die Versionsseite rekonstruiert den Stand nur lesend
(primärer Screenshot mit den freigegebenen Rahmen); „Als Basis für neue Session verwenden“
ist noch nicht umgesetzt.

## 5. Komponentenhistorie

`SELECT … FROM spec_revision_components JOIN spec_revisions … WHERE component_id = ?`
liefert für jede Komponente die Liste ihrer Revisionen über alle Versionen. Ein Wechsel
der `component_revision_id` zwischen zwei Versionen bedeutet eine Änderung. Daraus
entsteht in der History-Ansicht die Zeitleiste je Komponente mit Diff.

Umsetzung (Phase 4): `componentHistory` liefert je Version der UI die Komponenten-
revision (oder `null`) und den Diff zur vorherigen Version. Ob sich eine Komponente
geändert hat, entscheidet `compareVersions` und nicht der Revisionswechsel: Eine Region auf
einem neuen Screenshot ergibt eine neue Revision, ist aber inhaltlich keine Änderung.
REST: `GET /api/v1/projects/:pid/ui-views/:uiId/components/:componentId/history`.

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

Umsetzung (Phase 3): `GET /api/v1/versions/:id/export/{json|specification|prompt|screenshot|annotated}`
liefert die Datei als `attachment` (Dateiname `<ui-id>-v<n>…`). Bei Screenshots kann
`?screenshotId=` gewählt werden, sonst gilt der primäre. Alles wird aus dem unveränderlichen
Snapshot, dem gespeicherten Prompt und den Blobs erzeugt; der JSON-Export ist deterministisch.
Ein Prompt-Download zählt nicht als Auslieferung an den Agenten (E3). Die Farben der
Annotation stimmen mit denen des Editors überein (`DEPTH_COLORS` im Core).

**Import** prüft die Formatversion, alle Hashes und die Schemas. Erlaubt sind nur bekannte
Pfade im ZIP, maximale Gesamtgröße und Anzahl der Einträge sind begrenzt. Importierte
Versionen werden als neue unveränderliche Datensätze angelegt. Original-IDs bleiben
erhalten, wenn sie im Zielsystem frei sind. Andernfalls entsteht ein Import-Mapping, das
im Audit-Log protokolliert wird (E6).
