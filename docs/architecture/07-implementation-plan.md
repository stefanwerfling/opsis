# 07 – Implementierungsplan

Die Reihenfolge der Anforderung wurde in einem Punkt angepasst: **Der Freigabe- und
Snapshot-Mechanismus (Teile von Phase 4) wird in Phase 3 vorgezogen.** Der Prompt-Generator
braucht eine unveränderliche SpecRevision als Referenz („Der Prompt muss die zugehörige
UI-Version und Spezifikationsrevision referenzieren“). Der MCP-Server wird bewusst
**erst nach** dem fachlichen Kern gebaut, weil er nur ein Adapter auf die Use-Cases ist.

Jeder Schritt endet mit grünem `npm run check` (tsc, ESLint, Prettier, Vitest) und einem
Commit.

## Phase 1 – Grundsystem

1. Workspace-Setup: npm-Workspaces, TS 6.0 (ESM, `strict`, `noUncheckedIndexedAccess`),
   ESLint-Flat-Config inkl. Schichtregel, Prettier, Vitest, `npm run check`.
2. `core/domain`: IDs, Project, UiView (UI-ID-Format, Pfad-Normalisierung, Ableitung UI-ID
   aus Pfad), Screenshot-Metadaten. Tests.
3. `server/infrastructure/db`: Migrator, Migration 001 (Schema aus 03), Repositories,
   Transaktionshelfer. Tests mit In-Memory-SQLite, darunter der **Trigger-Test**
   „UPDATE auf ui_versions schlägt fehl“.
4. Blob-Store + Bildvalidierung (Magic Bytes, `sharp`-Decode, Limits, atomares
   Schreiben). Tests mit präparierten Dateien (PNG mit JPEG-Endung, abgeschnittenes Bild,
   Dekompressionsbombe, zu groß).
5. Use-Cases: Projekte CRUD, UiView anlegen und Pfad ändern, Screenshot hochladen
   (Mensch), Session anlegen. Status-Automat + Akteursregeln. Tests.
6. Fastify-REST `/api/v1`, Fehler-Mapping, pino, SSE-Endpunkt.
7. Web: Projektliste, UI-Liste, Screenshot-Upload, Canvas mit Zoom/Pan (Konva).

## Phase 2 – Komponentenmodell

1. Domain: DraftComponent, Region, Relation, Baumoperationen (einfügen, verschieben mit
   Zyklusprüfung, duplizieren mit neuer ID, löschen mit Teilbaum), SpecValue-Schemas.
2. Koordinaten-Modul `core/domain/geometry.ts`: Umrechnung Bild ↔ Bildschirm (Zoom,
   Pan, devicePixelRatio), Clamping. Ausführlich getestet, auch mit Zoomstufen und
   unterschiedlichen Screenshotgrößen.
3. Draft-Persistenz mit `rowVersion`. API für feingranulare Patches mit Debounce aus
   dem Editor.
4. Editor: Komponentenbaum (Drag & Drop), Rechteck-Werkzeug, Transformer,
   Mehrfachauswahl, Überlappung (Klick-Zyklus durch übereinanderliegende Regionen),
   Hierarchie-Farben, Ein-/Ausblenden, Relationen ziehen.
5. Inspektor mit allen Gruppen. Herkunfts-Badge pro Feld, „nicht spezifiziert“ als
   Default.

## Phase 3 – Spezifikation, Freigabe, Prompt

1. `assessCompleteness`, Konfliktregeln, manuelle Konflikte.
2. Freigabe-Use-Case (05 §2) inkl. ComponentRevision-Deduplizierung.
3. Spezifikations-Builder (JSON) + Markdown-Renderer + Prompt-Generator (deterministisch,
   versioniert über `generatorVersion`). **Snapshot-Tests** für vollständige,
   unvollständige, widersprüchliche und verschachtelte Spezifikationen.
4. Freigabe-Dialog im Editor (Blocker, Warnungen bestätigen, Änderungsbeschreibung).
5. Export JSON / Markdown / Original / annotiert.

## Phase 4 – History

1. Überarbeitungs-Sessions (Draft aus Basisversion, stabile Komponenten-IDs).
2. `compareVersions` + Komponentenhistorie. Tests.
3. Konflikterkennung paralleler Sessions + beide Auflösungswege.
4. History-Ansicht: Zeitleiste, Version öffnen (nur lesen), Overlay/Wisch/Seite-an-Seite,
   Pixeldiff, Komponenten-Diff.
5. ZIP-Export/-Import mit Manifest und Hash-Prüfung.

## Phase 5 – MCP

1. Agent-Verwaltung (CLI + UI), Token-Auth, AccessPolicy-Durchsetzung. Tests für
   den Zugriff auf fremde Projekte über **jedes** Tool und **jede** Ressource
   (tabellengetrieben).
2. MCP-Server-Factory, Tools aus 06. Integrationstests mit `@modelcontextprotocol/client`
   gegen den echten HTTP-Handler.
3. `wait_for_specification`: Tests für sofort fertig, Fertigstellung während des Wartens,
   Timeout, Abbruch durch den Client, abgebrochene Session, verlorenes Event (DB-Poll greift).
4. Ressourcen + `resources/updated`.
5. `request_upload` (zweistufiger Upload).

## Phase 6 – Qualität und Erweiterungen

Playwright-E2E (Agent reicht ein → Mensch annotiert → Agent erhält Prompt),
Performance-Messungen (Screenshots mit 8000 px Höhe, Bäume mit 1000 Komponenten,
Canvas-Virtualisierung der Overlays bei Bedarf), Security-Review, Dokumentation
(`docs/mcp.md`, Betrieb, Agent-Integrationsbeispiel/Skill), Docker-Image (optional).

## Teststrategie (Kurzfassung)

| Ebene       | Werkzeug                                                   | Schwerpunkt                                                                          |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Domain      | Vitest, reine Funktionen                                   | Statusautomat, Baumoperationen, Geometrie, Diff, Vollständigkeit, Prompt (Snapshots) |
| Application | Vitest + In-Memory-SQLite                                  | Use-Cases, Transaktionen, Konflikte, Unveränderlichkeit, Zugriffskontrolle           |
| Adapter     | Vitest + `fastify.inject` / MCP-Client                     | REST- und MCP-Verträge, Uploads, Fehlercodes                                         |
| Editor      | Vitest + Testing Library (Logik), Playwright (Interaktion) | Markieren, Verschieben, Zoom-Koordinaten                                             |
