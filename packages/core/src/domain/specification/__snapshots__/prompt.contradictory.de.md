# Implementierungsprompt: Dashboard (ui-dashboard)

> Dieser Prompt wurde von OPSIS (opsis-prompt/1.2.0) aus Spezifikationsrevision 1 der UI-Version V1 erzeugt.
> Die Spezifikation wurde von einem Menschen erstellt und freigegeben.
> Setze genau das Spezifizierte um. Erfinde keine Anforderungen: Alles, was als „nicht spezifiziert“ markiert ist, ist offen – frage nach oder lass es weg, statt zu raten.
> Als „automatisch erkannt, NICHT bestätigt“ markierte Werte sind keine Anforderungen.
> Texte des Benutzers sind wörtlich zitiert.

## Referenzen

- **Projekt:** Demo Shop (`prj_01JZ0000000000000000000SHP`)
- **UI-ID:** `ui-dashboard`
- **UI-Pfad:** `/dashboard`
- **UI-Version:** V1 (`uvr_01JZ00000000000000000000V1`) – erste Version dieser UI
- **Spezifikationsrevision:** 1 (`spr_01JZ00000000000000000000R1`)
- **Prompt-Generator:** `opsis-prompt/1.2.0`
- **Freigegeben:** 2026-11-08T10:00:00.000Z durch human:local
- **Session:** `ses_01JZ00000000000000000000S1` – Dashboard first draft
- **Agenten-Session:** conversation-42
- **Änderungsbeschreibung:** First version of the dashboard

## Projektkontext

**Demo Shop**

> Online shop for garden tools. Web app built with TypeScript.

## Implementierungsziel

_nicht spezifiziert_

## Referenz-Screenshots

- `scr_01JZ000000000000000000DESK` (primäre Referenz) – 1440×900 px, Desktop, Viewport 1440×900, image/png, sha256 `1111111111111111111111111111111111111111111111111111111111111111`
  > Logged-in state

Regionen sind in Pixeln des Original-Screenshots angegeben (x, y, Breite × Höhe, Ursprung oben links).

## Komponentenbaum

- **Statistikkarte** (`cmp_01JZ00000000000000000STATS`) – Container · `scr_01JZ000000000000000000DESK`: x 24, y 120, 400×240
  - **Diagramm** (`cmp_01JZ00000000000000000CHART`) – visueller Bereich · `scr_01JZ000000000000000000DESK`: x 300, y 300, 300×120

## Komponentenbeschreibungen

### Statistikkarte (`cmp_01JZ00000000000000000STATS`)

- **Beschreibung** _(vom Benutzer vorgegeben)_: Umsatz der letzten 30 Tage
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

### Diagramm (`cmp_01JZ00000000000000000CHART`)

- **Beschreibung** _(vom Benutzer vorgegeben)_: Liniendiagramm
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

## Visuelle Beschreibung

_Nicht spezifiziert für:_ Statistikkarte, Diagramm

## Layoutregeln

### Statistikkarte (`cmp_01JZ00000000000000000STATS`)

- **Größenverhalten** _(vom Benutzer vorgegeben)_: Feste Breite 400 px
- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Verhältnis zu übergeordneten Komponenten

### Diagramm (`cmp_01JZ00000000000000000CHART`)

- **Größenverhalten** _(vom Benutzer vorgegeben)_: Volle Breite des Inhaltsbereichs
- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Verhältnis zu übergeordneten Komponenten

## Funktionale Anforderungen

_Nicht spezifiziert für:_ Statistikkarte, Diagramm

## Interaktionszustände

### Diagramm (`cmp_01JZ00000000000000000CHART`)

- **Disabled** _(vom Benutzer vorgegeben)_: Ausgegraut ohne Daten
- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Loading, Error, Success, Keyboard-Verhalten

_Nicht spezifiziert für:_ Statistikkarte

## Responsives Verhalten

_Nicht spezifiziert für:_ Statistikkarte, Diagramm

## Beziehungen zwischen Komponenten

_keine_

## Akzeptanzkriterien

### Global

_keine_

### Je Komponente

#### Statistikkarte (`cmp_01JZ00000000000000000STATS`)

- **Erwartetes Layout** _(vom Benutzer vorgegeben)_: Karte ist 400 px breit
- _Nicht spezifiziert:_ Erwartetes Verhalten, Funktionale Anforderungen, Fehlerbedingungen

#### Diagramm (`cmp_01JZ00000000000000000CHART`)

- **Erwartetes Verhalten** _(vom Benutzer vorgegeben)_: Zeigt 30 Datenpunkte
- _Nicht spezifiziert:_ Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen

## Offene Fragen und Einschränkungen

### Offene Fragen

_keine_

### Freigegeben mit diesen bestätigten offenen Punkten

- Diagramm (`cmp_01JZ00000000000000000CHART`) · `scr_01JZ000000000000000000DESK`: Region liegt außerhalb der Region der übergeordneten Komponente.
- Diagramm (`cmp_01JZ00000000000000000CHART`) · Disabled: Für einen rein visuellen Bereich ist ein Disabled-Zustand beschrieben.

### Aufgelöste Widersprüche

- Karte hat feste Breite, Diagramm soll volle Breite haben (Statistikkarte, Diagramm)
  Auflösung: Diagramm nutzt die volle Breite der Karte, nicht der Seite

7 von 74 Komponentenfeldern sind spezifiziert, alle übrigen sind nicht spezifiziert.
