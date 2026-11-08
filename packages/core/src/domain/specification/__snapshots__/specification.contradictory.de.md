# Spezifikation: Dashboard (ui-dashboard)

## Referenzen

- **Projekt:** Demo Shop (`prj_01JZ0000000000000000000SHP`)
- **UI-ID:** `ui-dashboard`
- **UI-Pfad:** `/dashboard`
- **UI-Version:** V1 (`uvr_01JZ00000000000000000000V1`) – erste Version dieser UI
- **Spezifikationsrevision:** 1 (`spr_01JZ00000000000000000000R1`)
- **Prompt-Generator:** `opsis-prompt/1.0.0`
- **Freigegeben:** 2026-11-08T10:00:00.000Z durch human:local
- **Session:** `ses_01JZ00000000000000000000S1` – Dashboard first draft
- **Agenten-Session:** conversation-42
- **Änderungsbeschreibung:** First version of the dashboard

## Überblick

**Implementierungsziel:**

_nicht spezifiziert_

**Projektkontext:**

> Online shop for garden tools. Web app built with TypeScript.

## Referenz-Screenshots

- `scr_01JZ000000000000000000DESK` (primäre Referenz) – 1440×900 px, Desktop, Viewport 1440×900, image/png, sha256 `1111111111111111111111111111111111111111111111111111111111111111`
  > Logged-in state

Regionen sind in Pixeln des Original-Screenshots angegeben (x, y, Breite × Höhe, Ursprung oben links).

## Komponentenbaum

- **Statistikkarte** (`cmp_01JZ00000000000000000STATS`) – Container · `scr_01JZ000000000000000000DESK`: x 24, y 120, 400×240
  - **Diagramm** (`cmp_01JZ00000000000000000CHART`) – visueller Bereich · `scr_01JZ000000000000000000DESK`: x 300, y 300, 300×120

## Komponenten

### Statistikkarte (`cmp_01JZ00000000000000000STATS`)

- **Typ:** Container
- **Übergeordnet:** oberste Ebene
- **Region:** `scr_01JZ000000000000000000DESK`: x 24, y 120, 400×240

#### Allgemein

- **Beschreibung** _(vom Benutzer vorgegeben)_: Umsatz der letzten 30 Tage
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- _Nicht spezifiziert:_ Farben, Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten, Responsive Darstellung

#### Funktionale Eigenschaften

- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Aktionen, Abhängigkeiten

#### Interaktion

- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success, Keyboard-Verhalten

#### Layout

- **Größenverhalten** _(vom Benutzer vorgegeben)_: Feste Breite 400 px
- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- **Erwartetes Layout** _(vom Benutzer vorgegeben)_: Karte ist 400 px breit
- _Nicht spezifiziert:_ Erwartetes Verhalten, Funktionale Anforderungen, Fehlerbedingungen, Responsive Anforderungen

### Diagramm (`cmp_01JZ00000000000000000CHART`)

- **Typ:** visueller Bereich
- **Übergeordnet:** Statistikkarte
- **Region:** `scr_01JZ000000000000000000DESK`: x 300, y 300, 300×120

#### Allgemein

- **Beschreibung** _(vom Benutzer vorgegeben)_: Liniendiagramm
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- _Nicht spezifiziert:_ Farben, Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten, Responsive Darstellung

#### Funktionale Eigenschaften

- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Aktionen, Abhängigkeiten

#### Interaktion

- **Disabled** _(vom Benutzer vorgegeben)_: Ausgegraut ohne Daten
- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Loading, Error, Success, Keyboard-Verhalten

#### Layout

- **Größenverhalten** _(vom Benutzer vorgegeben)_: Volle Breite des Inhaltsbereichs
- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- **Erwartetes Verhalten** _(vom Benutzer vorgegeben)_: Zeigt 30 Datenpunkte
- _Nicht spezifiziert:_ Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen, Responsive Anforderungen

## Beziehungen zwischen Komponenten

_keine_

## Widersprüche

- Karte hat feste Breite, Diagramm soll volle Breite haben (Statistikkarte, Diagramm)
  Auflösung: Diagramm nutzt die volle Breite der Karte, nicht der Seite

## Globale Akzeptanzkriterien

_keine_

## Vollständigkeit

2 Komponenten, 7 von 74 Feldern spezifiziert.

Keine blockierenden Punkte.

### Freigegeben mit diesen bestätigten offenen Punkten

- Diagramm (`cmp_01JZ00000000000000000CHART`) · `scr_01JZ000000000000000000DESK`: Region liegt außerhalb der Region der übergeordneten Komponente.
- Diagramm (`cmp_01JZ00000000000000000CHART`) · Disabled: Für einen rein visuellen Bereich ist ein Disabled-Zustand beschrieben.

## Offene Fragen

_keine_
