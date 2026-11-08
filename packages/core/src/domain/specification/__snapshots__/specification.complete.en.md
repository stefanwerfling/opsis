# Specification: Dashboard (ui-dashboard)

## References

- **Project:** Demo Shop (`prj_01JZ0000000000000000000SHP`)
- **UI-ID:** `ui-dashboard`
- **UI path:** `/dashboard`
- **UI version:** V1 (`uvr_01JZ00000000000000000000V1`) – first version of this UI
- **Specification revision:** 1 (`spr_01JZ00000000000000000000R1`)
- **Prompt generator:** `opsis-prompt/1.1.0`
- **Released:** 2026-11-08T10:00:00.000Z by human:local
- **Session:** `ses_01JZ00000000000000000000S1` – Dashboard first draft
- **Agent session:** conversation-42
- **Change description:** First version of the dashboard

## Overview

**Implementation goal:**

> Implement the dashboard page as shown.

**Project context:**

> Online shop for garden tools. Web app built with TypeScript.

## Reference screenshots

- `scr_01JZ000000000000000000DESK` (primary reference) – 1440×900 px, desktop, viewport 1440×900, image/png, sha256 `1111111111111111111111111111111111111111111111111111111111111111`
  > Logged-in state
- `scr_01JZ00000000000000000000MB` – 390×844 px, mobile, viewport 390×844, variant „iPhone“, image/png, sha256 `2222222222222222222222222222222222222222222222222222222222222222`

Regions are given in pixels of the original screenshot (x, y, width × height, origin top left).

## Component tree

- **Header** (`cmp_01JZ0000000000000000HEADER`) – container · `scr_01JZ000000000000000000DESK`: x 0, y 0, 1440×80; `scr_01JZ00000000000000000000MB`: x 0, y 0, 390×64
  - **Logo** (`cmp_01JZ000000000000000000MARK`) – visual area · `scr_01JZ000000000000000000DESK`: x 24, y 16, 140×48
  - **MainNavigation** (`cmp_01JZ0000000000000000000NAV`) – interactive element · `scr_01JZ000000000000000000DESK`: x 900, y 20, 500×40
- **StatisticsCard** (`cmp_01JZ00000000000000000STATS`) – component · `scr_01JZ000000000000000000DESK`: x 24, y 120, 400×240

## Components

### Header (`cmp_01JZ0000000000000000HEADER`)

- **Type:** container
- **Parent:** top level
- **Region:** `scr_01JZ000000000000000000DESK`: x 0, y 0, 1440×80; `scr_01JZ00000000000000000000MB`: x 0, y 0, 390×64

#### General

- **Description** _(specified by user)_: Top bar with logo and navigation
- _Not specified:_ Purpose, Responsibility

#### Visual properties

- **Colours** _(derived from screenshot)_: Background #2457d6, text white
- **Responsive appearance** _(specified by user)_: Below 768 px the navigation collapses into a menu button
- _Not specified:_ Sizes, Spacing, Positioning, Typography, Borders, Shadows

#### Functional properties

- _Not specified:_ Task, Input data, Output data, Data sources, Actions, Dependencies

#### Interaction

- _Not specified:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success, Keyboard behaviour

#### Layout

- **Positioning** _(specified by user)_: Sticky at the top, full width
- _Not specified:_ Flexbox/Grid, Scrolling behaviour, Overflow, Sizing behaviour, Relation to parent components

#### Acceptance criteria

- **Expected layout** _(specified by user)_: Header stays visible while scrolling
- **Responsive requirements** _(specified by user)_: Height 64 px on mobile
- _Not specified:_ Expected behaviour, Functional requirements, Error conditions

### Logo (`cmp_01JZ000000000000000000MARK`)

- **Type:** visual area
- **Parent:** Header
- **Region:** `scr_01JZ000000000000000000DESK`: x 24, y 16, 140×48

#### General

- **Description** _(specified by user)_: Shop logo, links to the start page
- _Not specified:_ Purpose, Responsibility

#### Visual properties

- _Not specified:_ Colours, Sizes, Spacing, Positioning, Typography, Borders, Shadows, Responsive appearance

#### Functional properties

- _Not specified:_ Task, Input data, Output data, Data sources, Actions, Dependencies

#### Interaction

- _Not specified:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success, Keyboard behaviour

#### Layout

- _Not specified:_ Positioning, Flexbox/Grid, Scrolling behaviour, Overflow, Sizing behaviour, Relation to parent components

#### Acceptance criteria

- **Expected behaviour** _(specified by user)_: Click opens /
- _Not specified:_ Expected layout, Functional requirements, Error conditions, Responsive requirements

### MainNavigation (`cmp_01JZ0000000000000000000NAV`)

- **Type:** interactive element
- **Parent:** Header
- **Region:** `scr_01JZ000000000000000000DESK`: x 900, y 20, 500×40

#### General

- **Description** _(specified by user)_: Links: Dashboard, Orders, Settings
- _Not specified:_ Purpose, Responsibility

#### Visual properties

- _Not specified:_ Colours, Sizes, Spacing, Positioning, Typography, Borders, Shadows, Responsive appearance

#### Functional properties

- **Actions** _(specified by user)_: Navigates to the selected page
- _Not specified:_ Task, Input data, Output data, Data sources, Dependencies

#### Interaction

- **Hover** _(specified by user)_: Underline the hovered link
- **Keyboard behaviour** _(specified by user)_: Tab moves through the links, Enter opens
- _Not specified:_ Click, Focus, Active, Disabled, Loading, Error, Success

#### Layout

- _Not specified:_ Positioning, Flexbox/Grid, Scrolling behaviour, Overflow, Sizing behaviour, Relation to parent components

#### Acceptance criteria

- **Expected behaviour** _(specified by user)_: Active page link is highlighted
- _Not specified:_ Expected layout, Functional requirements, Error conditions, Responsive requirements

### StatisticsCard (`cmp_01JZ00000000000000000STATS`)

- **Type:** component
- **Parent:** top level
- **Region:** `scr_01JZ000000000000000000DESK`: x 24, y 120, 400×240

#### General

- **Description** _(specified by user)_: Revenue of the last 30 days
- _Not specified:_ Purpose, Responsibility

#### Visual properties

- _Not specified:_ Colours, Sizes, Spacing, Positioning, Typography, Borders, Shadows, Responsive appearance

#### Functional properties

- **Data sources** _(specified by user)_: GET /api/stats/revenue?days=30
- _Not specified:_ Task, Input data, Output data, Actions, Dependencies

#### Interaction

- **Loading** _(specified by user)_: Skeleton placeholder
- **Error** _(specified by user)_: Message "Could not load revenue" with retry button
- _Not specified:_ Hover, Click, Focus, Active, Disabled, Success, Keyboard behaviour

#### Layout

- _Not specified:_ Positioning, Flexbox/Grid, Scrolling behaviour, Overflow, Sizing behaviour, Relation to parent components

#### Acceptance criteria

- **Functional requirements** _(specified by user)_: Amount formatted in EUR
- _Not specified:_ Expected behaviour, Expected layout, Error conditions, Responsive requirements

## Relations between components

- **MainNavigation** controls **StatisticsCard** – Selecting "Orders" replaces the card

## Contradictions

_none_

## Global acceptance criteria

- Page loads in under 1 s
- No layout shift after loading

## Completeness

4 components, 18 of 148 fields specified.

No blocking issues.

### Released with these acknowledged open points

_none_

## Open questions

_none_
