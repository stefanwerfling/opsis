# Spezifikation: Dashboard (ui-dashboard)

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

## Überblick

**Implementierungsziel:**

> Implement the dashboard page as shown.

**Projektkontext:**

> Online shop for garden tools. Web app built with TypeScript.

## Referenz-Screenshots

- `scr_01JZ000000000000000000DESK` (primäre Referenz) – 1440×900 px, Desktop, Viewport 1440×900, image/png, sha256 `1111111111111111111111111111111111111111111111111111111111111111`
  > Logged-in state
- `scr_01JZ00000000000000000000MB` – 390×844 px, Mobil, Viewport 390×844, Variante „iPhone“, image/png, sha256 `2222222222222222222222222222222222222222222222222222222222222222`

Regionen sind in Pixeln des Original-Screenshots angegeben (x, y, Breite × Höhe, Ursprung oben links).

## Komponentenbaum

- **Header** (`cmp_01JZ0000000000000000HEADER`) – Container · `scr_01JZ000000000000000000DESK`: x 0, y 0, 1440×80; `scr_01JZ00000000000000000000MB`: x 0, y 0, 390×64
  - **Logo** (`cmp_01JZ000000000000000000MARK`) – visueller Bereich · `scr_01JZ000000000000000000DESK`: x 24, y 16, 140×48
  - **MainNavigation** (`cmp_01JZ0000000000000000000NAV`) – interaktives Element · `scr_01JZ000000000000000000DESK`: x 900, y 20, 500×40
- **StatisticsCard** (`cmp_01JZ00000000000000000STATS`) – Komponente · `scr_01JZ000000000000000000DESK`: x 24, y 120, 400×240

## Komponenten

### Header (`cmp_01JZ0000000000000000HEADER`)

- **Typ:** Container
- **Übergeordnet:** oberste Ebene
- **Region:** `scr_01JZ000000000000000000DESK`: x 0, y 0, 1440×80; `scr_01JZ00000000000000000000MB`: x 0, y 0, 390×64

#### Allgemein

- **Beschreibung** _(vom Benutzer vorgegeben)_: Top bar with logo and navigation
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- **Farben** _(aus Screenshot abgeleitet)_: Background #2457d6, text white
- **Responsive Darstellung** _(vom Benutzer vorgegeben)_: Below 768 px the navigation collapses into a menu button
- _Nicht spezifiziert:_ Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten

#### Funktionale Eigenschaften

- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Aktionen, Abhängigkeiten

#### Interaktion

- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success, Keyboard-Verhalten

#### Layout

- **Positionierung** _(vom Benutzer vorgegeben)_: Sticky at the top, full width
- _Nicht spezifiziert:_ Flexbox/Grid, Scrollverhalten, Overflow, Größenverhalten, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- **Erwartetes Layout** _(vom Benutzer vorgegeben)_: Header stays visible while scrolling
- **Responsive Anforderungen** _(vom Benutzer vorgegeben)_: Height 64 px on mobile
- _Nicht spezifiziert:_ Erwartetes Verhalten, Funktionale Anforderungen, Fehlerbedingungen

### Logo (`cmp_01JZ000000000000000000MARK`)

- **Typ:** visueller Bereich
- **Übergeordnet:** Header
- **Region:** `scr_01JZ000000000000000000DESK`: x 24, y 16, 140×48

#### Allgemein

- **Beschreibung** _(vom Benutzer vorgegeben)_: Shop logo, links to the start page
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

- **Erwartetes Verhalten** _(vom Benutzer vorgegeben)_: Click opens /
- _Nicht spezifiziert:_ Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen, Responsive Anforderungen

### MainNavigation (`cmp_01JZ0000000000000000000NAV`)

- **Typ:** interaktives Element
- **Übergeordnet:** Header
- **Region:** `scr_01JZ000000000000000000DESK`: x 900, y 20, 500×40

#### Allgemein

- **Beschreibung** _(vom Benutzer vorgegeben)_: Links: Dashboard, Orders, Settings
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- _Nicht spezifiziert:_ Farben, Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten, Responsive Darstellung

#### Funktionale Eigenschaften

- **Aktionen** _(vom Benutzer vorgegeben)_: Navigates to the selected page
- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Datenquellen, Abhängigkeiten

#### Interaktion

- **Hover** _(vom Benutzer vorgegeben)_: Underline the hovered link
- **Keyboard-Verhalten** _(vom Benutzer vorgegeben)_: Tab moves through the links, Enter opens
- _Nicht spezifiziert:_ Click, Focus, Active, Disabled, Loading, Error, Success

#### Layout

- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Größenverhalten, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- **Erwartetes Verhalten** _(vom Benutzer vorgegeben)_: Active page link is highlighted
- _Nicht spezifiziert:_ Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen, Responsive Anforderungen

### StatisticsCard (`cmp_01JZ00000000000000000STATS`)

- **Typ:** Komponente
- **Übergeordnet:** oberste Ebene
- **Region:** `scr_01JZ000000000000000000DESK`: x 24, y 120, 400×240

#### Allgemein

- **Beschreibung** _(vom Benutzer vorgegeben)_: Revenue of the last 30 days
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

#### Visuelle Eigenschaften

- _Nicht spezifiziert:_ Farben, Größen, Abstände, Positionierung, Typografie, Rahmen, Schatten, Responsive Darstellung

#### Funktionale Eigenschaften

- **Datenquellen** _(vom Benutzer vorgegeben)_: GET /api/stats/revenue?days=30
- _Nicht spezifiziert:_ Aufgabe, Eingabedaten, Ausgabedaten, Aktionen, Abhängigkeiten

#### Interaktion

- **Loading** _(vom Benutzer vorgegeben)_: Skeleton placeholder
- **Error** _(vom Benutzer vorgegeben)_: Message "Could not load revenue" with retry button
- _Nicht spezifiziert:_ Hover, Click, Focus, Active, Disabled, Success, Keyboard-Verhalten

#### Layout

- _Nicht spezifiziert:_ Positionierung, Flexbox/Grid, Scrollverhalten, Overflow, Größenverhalten, Verhältnis zu übergeordneten Komponenten

#### Akzeptanzkriterien

- **Funktionale Anforderungen** _(vom Benutzer vorgegeben)_: Amount formatted in EUR
- _Nicht spezifiziert:_ Erwartetes Verhalten, Erwartetes Layout, Fehlerbedingungen, Responsive Anforderungen

## Beziehungen zwischen Komponenten

- **MainNavigation** steuert **StatisticsCard** – Selecting "Orders" replaces the card

## Widersprüche

_keine_

## Globale Akzeptanzkriterien

- Page loads in under 1 s
- No layout shift after loading

## Vollständigkeit

4 Komponenten, 18 von 148 Feldern spezifiziert.

Keine blockierenden Punkte.

### Freigegeben mit diesen bestätigten offenen Punkten

_keine_

## Offene Fragen

_keine_
