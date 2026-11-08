# Implementierungsprompt: Dashboard (ui-dashboard)

> Dieser Prompt wurde von OPSIS (opsis-prompt/1.0.0) aus Spezifikationsrevision 1 der UI-Version V1 erzeugt.
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
- **Prompt-Generator:** `opsis-prompt/1.0.0`
- **Freigegeben:** 2026-11-08T10:00:00.000Z durch human:local
- **Session:** `ses_01JZ00000000000000000000S1` – Dashboard first draft
- **Agenten-Session:** conversation-42
- **Änderungsbeschreibung:** First version of the dashboard

## Projektkontext

**Demo Shop**

> Online shop for garden tools. Web app built with TypeScript.

## Implementierungsziel

> Karte gemäß Screenshot umsetzen.
> Bestehende Komponenten wiederverwenden.

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

## Komponentenbeschreibungen

### Karte (`cmp_01JZ00000000000000000STATS`)

- **Beschreibung** _(vom Benutzer vorgegeben)_: Karte mit Kopf und Inhalt
- _Nicht spezifiziert:_ Zweck, Verantwortlichkeit

_Nicht spezifiziert für:_ Inhalt, Legende, Legendeneintrag, Kartenkopf

## Visuelle Beschreibung

_Nicht spezifiziert für:_ Karte, Inhalt, Legende, Legendeneintrag, Kartenkopf

## Layoutregeln

_Nicht spezifiziert für:_ Karte, Inhalt, Legende, Legendeneintrag, Kartenkopf

## Funktionale Anforderungen

_Nicht spezifiziert für:_ Karte, Inhalt, Legende, Legendeneintrag, Kartenkopf

## Interaktionszustände

### Legendeneintrag (`cmp_01JZ00000000000000000ENTRY`)

- **Click** _(vom Benutzer vorgegeben)_:
  > Klick blendet die Datenreihe aus.
  > Erneuter Klick blendet sie wieder ein.
  >
  > - Zustand bleibt beim Neuladen erhalten
  - _Hinweis:_ Mit dem Produktteam abgestimmt
- _Nicht spezifiziert:_ Hover, Focus, Active, Disabled, Loading, Error, Success, Keyboard-Verhalten

_Nicht spezifiziert für:_ Karte, Inhalt, Legende, Kartenkopf

## Responsives Verhalten

_Nicht spezifiziert für:_ Karte, Inhalt, Legende, Legendeneintrag, Kartenkopf

## Beziehungen zwischen Komponenten

_keine_

## Akzeptanzkriterien

### Global

_keine_

### Je Komponente

#### Legendeneintrag (`cmp_01JZ00000000000000000ENTRY`)

- **Erwartetes Verhalten** _(vom Benutzer vorgegeben)_: Ausgeblendete Reihe ist durchgestrichen
- _Nicht spezifiziert:_ Erwartetes Layout, Funktionale Anforderungen, Fehlerbedingungen

_Nicht spezifiziert für:_ Karte, Inhalt, Legende, Kartenkopf

## Offene Fragen und Einschränkungen

### Offene Fragen

_keine_

### Freigegeben mit diesen bestätigten offenen Punkten

- Karte (`cmp_01JZ00000000000000000STATS`): Kein Akzeptanzkriterium.
- Inhalt (`cmp_01JZ00000000000000000CHART`): Keine Beschreibung.
- Inhalt (`cmp_01JZ00000000000000000CHART`): Kein Akzeptanzkriterium.
- Legende (`cmp_01JZ0000000000000000000KEY`): Keine Beschreibung.
- Legende (`cmp_01JZ0000000000000000000KEY`): Kein Akzeptanzkriterium.
- Legendeneintrag (`cmp_01JZ00000000000000000ENTRY`): Keine Beschreibung.
- Kartenkopf (`cmp_01JZ0000000000000000HEADER`): Keine Beschreibung.
- Kartenkopf (`cmp_01JZ0000000000000000HEADER`): Kein Akzeptanzkriterium.

3 von 185 Komponentenfeldern sind spezifiziert, alle übrigen sind nicht spezifiziert.
