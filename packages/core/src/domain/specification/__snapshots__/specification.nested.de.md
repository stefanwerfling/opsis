# Spezifikation: Dashboard (ui-dashboard)

## Referenzen

- **Projekt:** Demo Shop (`prj_01JZ0000000000000000000SHP`)
- **UI-ID:** `ui-dashboard`
- **UI-Pfad:** `/dashboard`
- **UI-Version:** V1 (`uvr_01JZ00000000000000000000V1`) – erste Version dieser UI
- **Spezifikationsrevision:** 1 (`spr_01JZ00000000000000000000R1`)
- **Prompt-Generator:** `opsis-prompt/1.1.0`
- **Freigegeben:** 2026-11-08T10:00:00.000Z durch human:local
- **Session:** `ses_01JZ00000000000000000000S1` – Dashboard first draft
- **Agenten-Session:** conversation-42
- **Änderungsbeschreibung:** First version of the dashboard

## Überblick

**Implementierungsziel:**

> Karte gemäß Screenshot umsetzen.
> Bestehende Komponenten wiederverwenden.

**Projektkontext:**

> Online shop for garden tools. Web app built with TypeScript.

## Referenz-Screenshots

- `scr_01JZ000000000000000000DESK` (primäre Referenz) – 1440×900 px, Desktop, Viewport 1440×900, image/png, sha256 `1111111111111111111111111111111111111111111111111111111111111111`
  > Logged-in state

Regionen sind in Pixeln des Original-Screenshots angegeben (x, y, Breite × Höhe, Ursprung oben links).

## Komponentenbaum

- **Karte** (`cmp_01JZ00000000000000000STATS`) – Container · `scr_01JZ000000000000000000DESK`: x 0, y 0, 600×400
  - **Inhalt** (`cmp_01JZ00000000000000000CHART`) – Gruppe · `scr_01JZ000000000000000000DESK`: x 10, y 50, 580×300
    - **Legende** (`cmp_01JZ0000000000000000000KEY`) – Komponente · `scr_01JZ000000000000000000DESK`: x 20, y 300, 300×40
      - **Legendeneintrag** (`cmp_01JZ00000000000000000ENTRY`) – interaktives Element · `scr_01JZ000000000000000000DESK`: x 24, y 304, 90×30
  - **Kartenkopf** (`cmp_01JZ0000000000000000HEADER`) – Komponente · `scr_01JZ000000000000000000DESK`: x 10, y 10, 580×36

## Komponenten

### Karte (`cmp_01JZ00000000000000000STATS`)

- **Typ:** Container
- **Übergeordnet:** oberste Ebene
- **Region:** `scr_01JZ000000000000000000DESK`: x 0, y 0, 600×400

#### Allgemein

- **Beschreibung** _(vom Benutzer vorgegeben)_: Karte mit Kopf und Inhalt
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- _Nicht spezifiziert:_ Farben, Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten, Responsive Darstellung

#### Funktionale Eigenschaften

- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Aktionen, Abhängigkeiten

#### Interaktion

- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success, Keyboard-Verhalten

#### Layout

- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Größenverhalten, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- _Nicht spezifiziert:_ Erwartetes Verhalten, Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen, Responsive Anforderungen

### Inhalt (`cmp_01JZ00000000000000000CHART`)

- **Typ:** Gruppe
- **Übergeordnet:** Karte
- **Region:** `scr_01JZ000000000000000000DESK`: x 10, y 50, 580×300

#### Allgemein

- _Nicht spezifiziert:_ Beschreibung, Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- _Nicht spezifiziert:_ Farben, Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten, Responsive Darstellung

#### Funktionale Eigenschaften

- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Aktionen, Abhängigkeiten

#### Interaktion

- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success, Keyboard-Verhalten

#### Layout

- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Größenverhalten, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- _Nicht spezifiziert:_ Erwartetes Verhalten, Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen, Responsive Anforderungen

### Legende (`cmp_01JZ0000000000000000000KEY`)

- **Typ:** Komponente
- **Übergeordnet:** Inhalt
- **Region:** `scr_01JZ000000000000000000DESK`: x 20, y 300, 300×40

#### Allgemein

- _Nicht spezifiziert:_ Beschreibung, Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- _Nicht spezifiziert:_ Farben, Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten, Responsive Darstellung

#### Funktionale Eigenschaften

- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Aktionen, Abhängigkeiten

#### Interaktion

- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success, Keyboard-Verhalten

#### Layout

- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Größenverhalten, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- _Nicht spezifiziert:_ Erwartetes Verhalten, Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen, Responsive Anforderungen

### Legendeneintrag (`cmp_01JZ00000000000000000ENTRY`)

- **Typ:** interaktives Element
- **Übergeordnet:** Legende
- **Region:** `scr_01JZ000000000000000000DESK`: x 24, y 304, 90×30

#### Allgemein

- _Nicht spezifiziert:_ Beschreibung, Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- _Nicht spezifiziert:_ Farben, Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten, Responsive Darstellung

#### Funktionale Eigenschaften

- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Aktionen, Abhängigkeiten

#### Interaktion

- **Click** _(vom Benutzer vorgegeben)_:
  > Klick blendet die Datenreihe aus.
  > Erneuter Klick blendet sie wieder ein.
  >
  > - Zustand bleibt beim Neuladen erhalten
  - _Hinweis:_ Mit dem Produktteam abgestimmt
- _Nicht spezifiziert:_ Hover, Focus, Active, Disabled, Loading, Error, Success, Keyboard-Verhalten

#### Layout

- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Größenverhalten, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- **Erwartetes Verhalten** _(vom Benutzer vorgegeben)_: Ausgeblendete Reihe ist durchgestrichen
- _Nicht spezifiziert:_ Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen, Responsive Anforderungen

### Kartenkopf (`cmp_01JZ0000000000000000HEADER`)

- **Typ:** Komponente
- **Übergeordnet:** Karte
- **Region:** `scr_01JZ000000000000000000DESK`: x 10, y 10, 580×36

#### Allgemein

- _Nicht spezifiziert:_ Beschreibung, Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- _Nicht spezifiziert:_ Farben, Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten, Responsive Darstellung

#### Funktionale Eigenschaften

- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Aktionen, Abhängigkeiten

#### Interaktion

- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success, Keyboard-Verhalten

#### Layout

- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Größenverhalten, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- _Nicht spezifiziert:_ Erwartetes Verhalten, Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen, Responsive Anforderungen

## Beziehungen zwischen Komponenten

_keine_

## Widersprüche

_keine_

## Globale Akzeptanzkriterien

_keine_

## Vollständigkeit

5 Komponenten, 3 von 185 Feldern spezifiziert.

Keine blockierenden Punkte.

### Freigegeben mit diesen bestätigten offenen Punkten

- Karte (`cmp_01JZ00000000000000000STATS`): Kein Akzeptanzkriterium.
- Inhalt (`cmp_01JZ00000000000000000CHART`): Keine Beschreibung.
- Inhalt (`cmp_01JZ00000000000000000CHART`): Kein Akzeptanzkriterium.
- Legende (`cmp_01JZ0000000000000000000KEY`): Keine Beschreibung.
- Legende (`cmp_01JZ0000000000000000000KEY`): Kein Akzeptanzkriterium.
- Legendeneintrag (`cmp_01JZ00000000000000000ENTRY`): Keine Beschreibung.
- Kartenkopf (`cmp_01JZ0000000000000000HEADER`): Keine Beschreibung.
- Kartenkopf (`cmp_01JZ0000000000000000HEADER`): Kein Akzeptanzkriterium.

## Offene Fragen

_keine_
