# Implementierungsprompt: Dashboard (ui-dashboard)

> Dieser Prompt wurde von OPSIS (opsis-prompt/1.2.0) aus Spezifikationsrevision 2 der UI-Version V2 erzeugt.
> Die Spezifikation wurde von einem Menschen erstellt und freigegeben.
> Setze genau das Spezifizierte um. Erfinde keine Anforderungen: Alles, was als „nicht spezifiziert“ markiert ist, ist offen – frage nach oder lass es weg, statt zu raten.
> Als „automatisch erkannt, NICHT bestätigt“ markierte Werte sind keine Anforderungen.
> Texte des Benutzers sind wörtlich zitiert.

## Referenzen

- **Projekt:** Demo Shop (`prj_01JZ0000000000000000000SHP`)
- **UI-ID:** `ui-dashboard`
- **UI-Pfad:** `/dashboard`
- **UI-Version:** V2 (`uvr_01JZ00000000000000000000V2`) – Vorgänger V1 (`uvr_01JZ00000000000000000000V1`)
- **Spezifikationsrevision:** 2 (`spr_01JZ00000000000000000000R2`)
- **Prompt-Generator:** `opsis-prompt/1.2.0`
- **Freigegeben:** 2026-11-08T10:00:00.000Z durch human:local
- **Session:** `ses_01JZ00000000000000000000S1` – Dashboard first draft
- **Agenten-Session:** conversation-42
- **Änderungsbeschreibung:** Header search

## Projektkontext

**Demo Shop**

> Online shop for garden tools. Web app built with TypeScript.

## Implementierungsziel

> Implement the dashboard page as shown.

**Zusammenfassung der Änderungen:**

> Search in the header, taller header, logo removed.

## Änderungen gegenüber V1

V1 gilt als umgesetzt. Setze die hier aufgeführten Unterschiede um; für alles Weitere bleibt die vollständige Spezifikation unten maßgeblich.

### Neue Komponenten

- SearchField (`cmp_01JZ00000000000000000ENTRY`) – unten vollständig beschrieben

### Geänderte Komponenten

- **Header** (`cmp_01JZ0000000000000000HEADER`)
  - Region (Desktop, verschoben, Größe geändert): x 0, y 0, 1440×80 → x 0, y 0, 1440×96
  - **Layout › Positionierung**
    - _vorher_ _(vom Benutzer vorgegeben)_: Sticky at the top, full width
    - _nachher_ _(vom Benutzer vorgegeben)_:
      > Sticky at the top, full width
      > Shadow when scrolled
- **MainNavigation** (`cmp_01JZ0000000000000000000NAV`)
  - **Interaktion › Hover**
    - _vorher_ _(vom Benutzer vorgegeben)_: Underline the hovered link
    - _nachher:_ _nicht spezifiziert_
- **RevenueCard** (`cmp_01JZ00000000000000000STATS`)
  - Umbenannt: „StatisticsCard“ → „RevenueCard“

### Entfernte Komponenten (aus der UI entfernen)

- Logo (`cmp_01JZ000000000000000000MARK`)

### Hinzugefügte Beziehungen

- **SearchField** liefert Daten an **RevenueCard**

### Geänderte Beziehungen

- _vorher:_ **MainNavigation** steuert **RevenueCard** – Selecting "Orders" replaces the card
- _nachher:_ **MainNavigation** steuert **RevenueCard** – Selecting "Orders" filters the card

**Hinzugefügte globale Akzeptanzkriterien:**

- Search answers in under 300 ms

## Referenz-Screenshots

- `scr_01JZ000000000000000000DESK` (primäre Referenz) – 1440×900 px, Desktop, Viewport 1440×900, image/png, sha256 `1111111111111111111111111111111111111111111111111111111111111111`
  > Logged-in state
- `scr_01JZ00000000000000000000MB` – 390×844 px, Mobil, Viewport 390×844, Variante „iPhone“, image/png, sha256 `2222222222222222222222222222222222222222222222222222222222222222`

Regionen sind in Pixeln des Original-Screenshots angegeben (x, y, Breite × Höhe, Ursprung oben links).

## Komponentenbaum

- **Header** (`cmp_01JZ0000000000000000HEADER`) – Container · `scr_01JZ000000000000000000DESK`: x 0, y 0, 1440×96; `scr_01JZ00000000000000000000MB`: x 0, y 0, 390×64
  - **MainNavigation** (`cmp_01JZ0000000000000000000NAV`) – interaktives Element · `scr_01JZ000000000000000000DESK`: x 900, y 20, 500×40
  - **SearchField** (`cmp_01JZ00000000000000000ENTRY`) – interaktives Element · `scr_01JZ000000000000000000DESK`: x 400, y 24, 360×48
- **RevenueCard** (`cmp_01JZ00000000000000000STATS`) – Komponente · `scr_01JZ000000000000000000DESK`: x 24, y 120, 400×240

## Komponentenbeschreibungen

### Header (`cmp_01JZ0000000000000000HEADER`)

- **Beschreibung** _(vom Benutzer vorgegeben)_: Top bar with logo and navigation
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

### MainNavigation (`cmp_01JZ0000000000000000000NAV`)

- **Beschreibung** _(vom Benutzer vorgegeben)_: Links: Dashboard, Orders, Settings
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

### SearchField (`cmp_01JZ00000000000000000ENTRY`)

- **Beschreibung** _(vom Benutzer vorgegeben)_: Search over orders
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

### RevenueCard (`cmp_01JZ00000000000000000STATS`)

- **Beschreibung** _(vom Benutzer vorgegeben)_: Revenue of the last 30 days
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

## Visuelle Beschreibung

### Header (`cmp_01JZ0000000000000000HEADER`)

- **Farben** _(aus Screenshot abgeleitet)_: Background #2457d6, text white
- _Nicht spezifiziert:_ Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten

_Nicht spezifiziert für:_ MainNavigation, SearchField, RevenueCard

## Layoutregeln

### Header (`cmp_01JZ0000000000000000HEADER`)

- **Positionierung** _(vom Benutzer vorgegeben)_:
  > Sticky at the top, full width
  > Shadow when scrolled
- _Nicht spezifiziert:_ Flexbox/Grid, Scrollverhalten, Overflow, Größenverhalten, Verhältnis zu übergeordneten Komponenten

_Nicht spezifiziert für:_ MainNavigation, SearchField, RevenueCard

## Funktionale Anforderungen

### MainNavigation (`cmp_01JZ0000000000000000000NAV`)

- **Aktionen** _(vom Benutzer vorgegeben)_: Navigates to the selected page
- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Abhängigkeiten

### RevenueCard (`cmp_01JZ00000000000000000STATS`)

- **Datenquellen** _(vom Benutzer vorgegeben)_: GET /api/stats/revenue?days=30
- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Aktionen, Abhängigkeiten

_Nicht spezifiziert für:_ Header, SearchField

## Interaktionszustände

### MainNavigation (`cmp_01JZ0000000000000000000NAV`)

- **Keyboard-Verhalten** _(vom Benutzer vorgegeben)_: Tab moves through the links, Enter opens
- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success

### RevenueCard (`cmp_01JZ00000000000000000STATS`)

- **Loading** _(vom Benutzer vorgegeben)_: Skeleton placeholder
- **Error** _(vom Benutzer vorgegeben)_: Message "Could not load revenue" with retry button
- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Disabled, Success, Keyboard-Verhalten

_Nicht spezifiziert für:_ Header, SearchField

## Responsives Verhalten

### Header (`cmp_01JZ0000000000000000HEADER`)

- **Responsive Darstellung** _(vom Benutzer vorgegeben)_: Below 768 px the navigation collapses into a menu button
- **Responsive Anforderungen** _(vom Benutzer vorgegeben)_: Height 64 px on mobile

_Nicht spezifiziert für:_ MainNavigation, SearchField, RevenueCard

### Regionen je Screenshot-Variante

- Header (`cmp_01JZ0000000000000000HEADER`): `scr_01JZ000000000000000000DESK`: x 0, y 0, 1440×96; `scr_01JZ00000000000000000000MB`: x 0, y 0, 390×64
- MainNavigation (`cmp_01JZ0000000000000000000NAV`): `scr_01JZ000000000000000000DESK`: x 900, y 20, 500×40; keine Region auf `scr_01JZ00000000000000000000MB`
- SearchField (`cmp_01JZ00000000000000000ENTRY`): `scr_01JZ000000000000000000DESK`: x 400, y 24, 360×48; keine Region auf `scr_01JZ00000000000000000000MB`
- RevenueCard (`cmp_01JZ00000000000000000STATS`): `scr_01JZ000000000000000000DESK`: x 24, y 120, 400×240; keine Region auf `scr_01JZ00000000000000000000MB`

## Beziehungen zwischen Komponenten

- **MainNavigation** steuert **RevenueCard** – Selecting "Orders" filters the card
- **SearchField** liefert Daten an **RevenueCard**

## Akzeptanzkriterien

### Global

- Page loads in under 1 s
- No layout shift after loading
- Search answers in under 300 ms

### Je Komponente

#### Header (`cmp_01JZ0000000000000000HEADER`)

- **Erwartetes Layout** _(vom Benutzer vorgegeben)_: Header stays visible while scrolling
- _Nicht spezifiziert:_ Erwartetes Verhalten, Funktionale Anforderungen, Fehlerbedingungen

#### MainNavigation (`cmp_01JZ0000000000000000000NAV`)

- **Erwartetes Verhalten** _(vom Benutzer vorgegeben)_: Active page link is highlighted
- _Nicht spezifiziert:_ Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen

#### SearchField (`cmp_01JZ00000000000000000ENTRY`)

- **Erwartetes Verhalten** _(vom Benutzer vorgegeben)_: Enter opens the result list
- _Nicht spezifiziert:_ Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen

#### RevenueCard (`cmp_01JZ00000000000000000STATS`)

- **Funktionale Anforderungen** _(vom Benutzer vorgegeben)_: Amount formatted in EUR
- _Nicht spezifiziert:_ Erwartetes Verhalten, Erwartetes Layout, Fehlerbedingungen

## Offene Fragen und Einschränkungen

### Offene Fragen

_keine_

### Freigegeben mit diesen bestätigten offenen Punkten

_keine_

17 von 148 Komponentenfeldern sind spezifiziert, alle übrigen sind nicht spezifiziert.
