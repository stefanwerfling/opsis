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

_not specified_

**Project context:**

> Online shop for garden tools. Web app built with TypeScript.

## Reference screenshots

- `scr_01JZ000000000000000000DESK` (primary reference) – 1440×900 px, desktop, viewport 1440×900, image/png, sha256 `1111111111111111111111111111111111111111111111111111111111111111`
  > Logged-in state

Regions are given in pixels of the original screenshot (x, y, width × height, origin top left).

## Component tree

- **Header** (`cmp_01JZ0000000000000000HEADER`) – container · `scr_01JZ000000000000000000DESK`: x 0, y 0, 1440×80
- **StatisticsCard** (`cmp_01JZ00000000000000000STATS`) – component · no region on `scr_01JZ000000000000000000DESK`

## Components

### Header (`cmp_01JZ0000000000000000HEADER`)

- **Type:** container
- **Parent:** top level
- **Region:** `scr_01JZ000000000000000000DESK`: x 0, y 0, 1440×80

#### General

- _Not specified:_ Description, Purpose, Responsibility

#### Visual properties

- **Colours** _(auto-detected, NOT confirmed – not a requirement)_: #2457d6
- _Not specified:_ Sizes, Spacing, Positioning, Typography, Borders, Shadows, Responsive appearance

#### Functional properties

- _Not specified:_ Task, Input data, Output data, Data sources, Actions, Dependencies

#### Interaction

- _Not specified:_ Hover, Click, Focus, Active, Disabled, Loading, Error, Success, Keyboard behaviour

#### Layout

- _Not specified:_ Positioning, Flexbox/Grid, Scrolling behaviour, Overflow, Sizing behaviour, Relation to parent components

#### Acceptance criteria

- _Not specified:_ Expected behaviour, Expected layout, Functional requirements, Error conditions, Responsive requirements

### StatisticsCard (`cmp_01JZ00000000000000000STATS`)

- **Type:** component
- **Parent:** top level
- **Region:** no region on `scr_01JZ000000000000000000DESK`

#### General

- **Description** _(specified by user)_: Shows revenue
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

- _Not specified:_ Expected behaviour, Expected layout, Functional requirements, Error conditions, Responsive requirements

## Relations between components

_none_

## Contradictions

_none_

## Global acceptance criteria

_none_

## Completeness

2 components, 2 of 74 fields specified.

No blocking issues.

### Released with these acknowledged open points

- Header (`cmp_01JZ0000000000000000HEADER`): No description.
- Header (`cmp_01JZ0000000000000000HEADER`): No acceptance criterion.
- Header (`cmp_01JZ0000000000000000HEADER`) · Colours: Auto-detected value not confirmed.
- StatisticsCard (`cmp_01JZ00000000000000000STATS`): No acceptance criterion.
- There are open questions.

## Open questions

- Which currency?
- Is there a dark mode?
