/**
 * Fixed wording of the generated documents in the project's prompt language (decision E8).
 * Only this frame is translated; texts written by the user are always copied verbatim.
 *
 * These labels are part of the generator, deliberately separate from the web UI catalogue:
 * renaming something in the UI must not change what a prompt generator version produces.
 */
import type { IssueCode } from '../completeness.js';
import type {
  ComponentKind,
  DeviceCategory,
  PromptLanguage,
  RelationKind,
  SpecField,
  SpecGroup,
  SpecOrigin,
} from '../vocabulary.js';

type Template = (values: Readonly<Record<string, string | number>>) => string;

export interface Labels {
  readonly notSpecified: string;
  readonly none: string;
  readonly yes: string;
  readonly groups: Readonly<Record<SpecGroup, string>>;
  readonly fields: { readonly [G in SpecGroup]: Readonly<Record<SpecField<G>, string>> };
  readonly origins: Readonly<Record<SpecOrigin, string>>;
  readonly kinds: Readonly<Record<ComponentKind, string>>;
  readonly relations: Readonly<Record<RelationKind, string>>;
  readonly devices: Readonly<Record<DeviceCategory, string>>;
  readonly issues: Readonly<Record<IssueCode, string>>;
  readonly text: {
    readonly specTitle: Template;
    readonly promptTitle: Template;
    readonly promptIntro: Template;
    readonly references: string;
    readonly project: string;
    readonly uiId: string;
    readonly uiPath: string;
    readonly uiVersion: string;
    readonly firstVersion: string;
    readonly predecessor: Template;
    readonly baseVersion: Template;
    readonly rebased: Template;
    readonly specRevision: string;
    readonly generator: string;
    readonly releasedLabel: string;
    readonly released: Template;
    readonly session: string;
    readonly agentSession: string;
    readonly projectContext: string;
    readonly uiDescription: string;
    readonly goal: string;
    readonly changeDescription: string;
    readonly changeSummary: string;
    readonly screenshots: string;
    readonly primary: string;
    readonly variant: string;
    readonly pixels: Template;
    readonly viewport: Template;
    readonly coordinatesNote: string;
    readonly componentTree: string;
    readonly noComponents: string;
    readonly regionLabel: string;
    readonly region: Template;
    readonly noRegionOn: Template;
    readonly componentDescriptions: string;
    readonly visual: string;
    readonly layout: string;
    readonly functional: string;
    readonly interaction: string;
    readonly responsive: string;
    readonly responsiveVariants: string;
    readonly relations: string;
    readonly acceptance: string;
    readonly globalAcceptance: string;
    readonly globalAcceptanceHeading: string;
    readonly componentAcceptance: string;
    readonly openPoints: string;
    readonly openQuestions: string;
    readonly acknowledgedWarnings: string;
    readonly resolvedConflicts: string;
    readonly resolution: string;
    readonly unspecifiedSummary: Template;
    readonly unspecifiedFields: string;
    readonly unspecifiedFor: string;
    readonly note: string;
    readonly components: string;
    readonly overview: string;
    readonly completeness: string;
    readonly completenessCounts: Template;
    readonly blockingNone: string;
    readonly conflicts: string;
    readonly kind: string;
    readonly parent: string;
    readonly root: string;
    readonly changesTitle: Template;
    readonly changesIntro: Template;
    /** Intro when the predecessor was never delivered to an agent (it may not be implemented). */
    readonly changesIntroUndelivered: Template;
    /** Fields whose text stayed the same but which went from auto_detected to confirmed. */
    readonly confirmedFields: Template;
    readonly noDifferences: Template;
    readonly addedComponents: string;
    readonly changedComponents: string;
    readonly removedComponents: string;
    readonly unchangedComponents: string;
    readonly renamed: Template;
    readonly kindChanged: Template;
    readonly parentChanged: Template;
    readonly reordered: string;
    readonly regionChanged: Template;
    readonly moved: string;
    readonly resized: string;
    readonly before: string;
    readonly after: string;
    readonly seeBelow: string;
    readonly relationsAdded: string;
    readonly relationsRemoved: string;
    readonly relationsChanged: string;
    readonly goalChanged: string;
    readonly acceptanceAdded: string;
    readonly acceptanceRemoved: string;
    readonly questionsAdded: string;
    readonly questionsRemoved: string;
  };
}

const en: Labels = {
  notSpecified: 'not specified',
  none: 'none',
  yes: 'yes',
  groups: {
    general: 'General',
    visual: 'Visual properties',
    functional: 'Functional properties',
    interaction: 'Interaction',
    layout: 'Layout',
    acceptance: 'Acceptance criteria',
  },
  fields: {
    general: { description: 'Description', purpose: 'Purpose', responsibility: 'Responsibility' },
    visual: {
      colors: 'Colours',
      sizes: 'Sizes',
      spacing: 'Spacing',
      positioning: 'Positioning',
      typography: 'Typography',
      borders: 'Borders',
      shadows: 'Shadows',
      responsive: 'Responsive appearance',
    },
    functional: {
      task: 'Task',
      inputData: 'Input data',
      outputData: 'Output data',
      dataSources: 'Data sources',
      actions: 'Actions',
      dependencies: 'Dependencies',
    },
    interaction: {
      hover: 'Hover',
      click: 'Click',
      focus: 'Focus',
      active: 'Active',
      disabled: 'Disabled',
      loading: 'Loading',
      error: 'Error',
      success: 'Success',
      keyboard: 'Keyboard behaviour',
    },
    layout: {
      positioning: 'Positioning',
      flexGrid: 'Flexbox/Grid',
      scrolling: 'Scrolling behaviour',
      overflow: 'Overflow',
      sizing: 'Sizing behaviour',
      parentRelation: 'Relation to parent components',
    },
    acceptance: {
      expectedBehavior: 'Expected behaviour',
      expectedLayout: 'Expected layout',
      functionalRequirements: 'Functional requirements',
      errorConditions: 'Error conditions',
      responsiveRequirements: 'Responsive requirements',
    },
  },
  origins: {
    user: 'specified by user',
    screenshot_derived: 'derived from screenshot',
    auto_detected: 'auto-detected, NOT confirmed – not a requirement',
  },
  kinds: {
    component: 'component',
    container: 'container',
    visual_area: 'visual area',
    interactive: 'interactive element',
    group: 'group',
  },
  relations: {
    controls: 'controls',
    navigates_to: 'navigates to',
    data_flow: 'passes data to',
    depends_on: 'depends on',
    other: 'is related to',
  },
  devices: { desktop: 'desktop', tablet: 'tablet', mobile: 'mobile', other: 'other device' },
  issues: {
    no_components: 'No components are defined.',
    assignment_unconfirmed: 'The UI assignment is not confirmed.',
    open_conflict: 'A contradiction is still open.',
    dangling_relation: 'A relation points to a component that does not exist.',
    unnamed_component: 'A component has no name.',
    inherited_region: 'A region was not yet checked against the new screenshot.',
    missing_description: 'No description.',
    missing_acceptance: 'No acceptance criterion.',
    unconfirmed_auto_detected: 'Auto-detected value not confirmed.',
    open_questions: 'There are open questions.',
    region_outside_parent: 'Region lies outside the region of its parent component.',
    disabled_on_visual_area: 'A disabled state is described for a pure visual area.',
  },
  text: {
    specTitle: (v) => `Specification: ${String(v['name'])} (${String(v['uiId'])})`,
    promptTitle: (v) => `Implementation prompt: ${String(v['name'])} (${String(v['uiId'])})`,
    promptIntro: (v) =>
      [
        `This prompt was generated by OPSIS (${String(v['generator'])}) from specification revision ${String(v['revisionNo'])} of UI version V${String(v['versionNo'])}.`,
        'The specification was written and released by a human.',
        'Implement exactly what is specified. Do not invent requirements: anything marked "not specified" is open – ask or leave it out instead of guessing.',
        'Values marked "auto-detected, NOT confirmed" are not requirements.',
        'Texts written by the user are quoted verbatim.',
      ].join('\n'),
    references: 'References',
    project: 'Project',
    uiId: 'UI-ID',
    uiPath: 'UI path',
    uiVersion: 'UI version',
    firstVersion: 'first version of this UI',
    predecessor: (v) => `predecessor V${String(v['versionNo'])} (\`${String(v['id'])}\`)`,
    baseVersion: (v) => `based on V${String(v['versionNo'])} (\`${String(v['id'])}\`)`,
    rebased: (v) => `base updated from V${String(v['from'])} to V${String(v['to'])}`,
    specRevision: 'Specification revision',
    generator: 'Prompt generator',
    releasedLabel: 'Released',
    released: (v) => `${String(v['at'])} by ${String(v['by'])}`,
    session: 'Session',
    agentSession: 'Agent session',
    projectContext: 'Project context',
    uiDescription: 'About this UI',
    goal: 'Implementation goal',
    changeDescription: 'Change description',
    changeSummary: 'Summary of changes',
    screenshots: 'Reference screenshots',
    primary: 'primary reference',
    variant: 'variant',
    pixels: (v) => `${String(v['width'])}×${String(v['height'])} px`,
    viewport: (v) => `viewport ${String(v['width'])}×${String(v['height'])}`,
    coordinatesNote:
      'Regions are given in pixels of the original screenshot (x, y, width × height, origin top left).',
    componentTree: 'Component tree',
    regionLabel: 'Region',
    noComponents: 'No components.',
    region: (v) =>
      `\`${String(v['screenshot'])}\`: x ${String(v['x'])}, y ${String(v['y'])}, ${String(v['width'])}×${String(v['height'])}`,
    noRegionOn: (v) => `no region on \`${String(v['screenshot'])}\``,
    componentDescriptions: 'Component descriptions',
    visual: 'Visual description',
    layout: 'Layout rules',
    functional: 'Functional requirements',
    interaction: 'Interaction states',
    responsive: 'Responsive behaviour',
    responsiveVariants: 'Regions per screenshot variant',
    relations: 'Relations between components',
    acceptance: 'Acceptance criteria',
    globalAcceptance: 'Global',
    globalAcceptanceHeading: 'Global acceptance criteria',
    componentAcceptance: 'Per component',
    openPoints: 'Open questions and limitations',
    openQuestions: 'Open questions',
    acknowledgedWarnings: 'Released with these acknowledged open points',
    resolvedConflicts: 'Resolved contradictions',
    resolution: 'Resolution',
    unspecifiedSummary: (v) =>
      `${String(v['specified'])} of ${String(v['total'])} component fields are specified; all others are not specified.`,
    unspecifiedFields: 'Not specified',
    unspecifiedFor: 'Not specified for',
    note: 'Note',
    components: 'Components',
    overview: 'Overview',
    completeness: 'Completeness',
    completenessCounts: (v) =>
      `${String(v['components'])} components, ${String(v['specified'])} of ${String(v['total'])} fields specified.`,
    blockingNone: 'No blocking issues.',
    conflicts: 'Contradictions',
    kind: 'Type',
    parent: 'Parent',
    root: 'top level',
    changesTitle: (v) => `Changes compared to V${String(v['versionNo'])}`,
    changesIntro: (v) =>
      `V${String(v['versionNo'])} is assumed to be implemented. Implement the differences listed here; the full specification below remains the reference for everything else.`,
    changesIntroUndelivered: (v) =>
      `V${String(v['versionNo'])} was never recorded as delivered to an agent, so it may not be implemented. The differences listed here are for orientation only – implement the full specification below.`,
    confirmedFields: (v) =>
      `Confirmed with unchanged text (only auto-detected in V${String(v['versionNo'])}, now a requirement): ${String(v['fields'])}`,
    noDifferences: (v) => `No specified differences to V${String(v['versionNo'])}.`,
    addedComponents: 'New components',
    changedComponents: 'Changed components',
    removedComponents: 'Removed components (remove from the UI)',
    unchangedComponents: 'Unchanged components (existing requirements, keep as they are)',
    renamed: (v) => `Renamed: "${String(v['before'])}" → "${String(v['after'])}"`,
    kindChanged: (v) => `Type: ${String(v['before'])} → ${String(v['after'])}`,
    parentChanged: (v) => `Moved in the hierarchy: ${String(v['before'])} → ${String(v['after'])}`,
    reordered: 'Order among its siblings changed',
    regionChanged: (v) =>
      `Region (${String(v['device'])}, ${String(v['what'])}): x ${String(v['bx'])}, y ${String(v['by'])}, ${String(v['bw'])}×${String(v['bh'])} → x ${String(v['ax'])}, y ${String(v['ay'])}, ${String(v['aw'])}×${String(v['ah'])}`,
    moved: 'moved',
    resized: 'resized',
    before: 'before',
    after: 'after',
    seeBelow: 'described in full below',
    relationsAdded: 'Relations added',
    relationsRemoved: 'Relations removed',
    relationsChanged: 'Relations changed',
    goalChanged: 'Implementation goal changed',
    acceptanceAdded: 'Global acceptance criteria added',
    acceptanceRemoved: 'Global acceptance criteria removed',
    questionsAdded: 'Open questions added',
    questionsRemoved: 'Open questions removed',
  },
};

const de: Labels = {
  notSpecified: 'nicht spezifiziert',
  none: 'keine',
  yes: 'ja',
  groups: {
    general: 'Allgemein',
    visual: 'Visuelle Eigenschaften',
    functional: 'Funktionale Eigenschaften',
    interaction: 'Interaktion',
    layout: 'Layout',
    acceptance: 'Akzeptanzkriterien',
  },
  fields: {
    general: { description: 'Beschreibung', purpose: 'Zweck', responsibility: 'Verantwortlichkeit' },
    visual: {
      colors: 'Farben',
      sizes: 'Größen',
      spacing: 'Abstände',
      positioning: 'Positionierung',
      typography: 'Typografie',
      borders: 'Rahmen',
      shadows: 'Schatten',
      responsive: 'Responsive Darstellung',
    },
    functional: {
      task: 'Aufgabe',
      inputData: 'Eingabedaten',
      outputData: 'Ausgabedaten',
      dataSources: 'Datenquellen',
      actions: 'Aktionen',
      dependencies: 'Abhängigkeiten',
    },
    interaction: {
      hover: 'Hover',
      click: 'Click',
      focus: 'Focus',
      active: 'Active',
      disabled: 'Disabled',
      loading: 'Loading',
      error: 'Error',
      success: 'Success',
      keyboard: 'Keyboard-Verhalten',
    },
    layout: {
      positioning: 'Positionierung',
      flexGrid: 'Flexbox/Grid',
      scrolling: 'Scrollverhalten',
      overflow: 'Overflow',
      sizing: 'Größenverhalten',
      parentRelation: 'Verhältnis zu übergeordneten Komponenten',
    },
    acceptance: {
      expectedBehavior: 'Erwartetes Verhalten',
      expectedLayout: 'Erwartetes Layout',
      functionalRequirements: 'Funktionale Anforderungen',
      errorConditions: 'Fehlerbedingungen',
      responsiveRequirements: 'Responsive Anforderungen',
    },
  },
  origins: {
    user: 'vom Benutzer vorgegeben',
    screenshot_derived: 'aus Screenshot abgeleitet',
    auto_detected: 'automatisch erkannt, NICHT bestätigt – keine Anforderung',
  },
  kinds: {
    component: 'Komponente',
    container: 'Container',
    visual_area: 'visueller Bereich',
    interactive: 'interaktives Element',
    group: 'Gruppe',
  },
  relations: {
    controls: 'steuert',
    navigates_to: 'navigiert zu',
    data_flow: 'liefert Daten an',
    depends_on: 'hängt ab von',
    other: 'steht in Beziehung zu',
  },
  devices: { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobil', other: 'anderes Gerät' },
  issues: {
    no_components: 'Es sind keine Komponenten definiert.',
    assignment_unconfirmed: 'Die UI-Zuordnung ist nicht bestätigt.',
    open_conflict: 'Ein Widerspruch ist noch offen.',
    dangling_relation: 'Eine Beziehung verweist auf eine nicht vorhandene Komponente.',
    unnamed_component: 'Eine Komponente hat keinen Namen.',
    inherited_region: 'Eine Region wurde noch nicht am neuen Screenshot geprüft.',
    missing_description: 'Keine Beschreibung.',
    missing_acceptance: 'Kein Akzeptanzkriterium.',
    unconfirmed_auto_detected: 'Automatisch erkannter Wert nicht bestätigt.',
    open_questions: 'Es gibt offene Fragen.',
    region_outside_parent: 'Region liegt außerhalb der Region der übergeordneten Komponente.',
    disabled_on_visual_area: 'Für einen rein visuellen Bereich ist ein Disabled-Zustand beschrieben.',
  },
  text: {
    specTitle: (v) => `Spezifikation: ${String(v['name'])} (${String(v['uiId'])})`,
    promptTitle: (v) => `Implementierungsprompt: ${String(v['name'])} (${String(v['uiId'])})`,
    promptIntro: (v) =>
      [
        `Dieser Prompt wurde von OPSIS (${String(v['generator'])}) aus Spezifikationsrevision ${String(v['revisionNo'])} der UI-Version V${String(v['versionNo'])} erzeugt.`,
        'Die Spezifikation wurde von einem Menschen erstellt und freigegeben.',
        'Setze genau das Spezifizierte um. Erfinde keine Anforderungen: Alles, was als „nicht spezifiziert“ markiert ist, ist offen – frage nach oder lass es weg, statt zu raten.',
        'Als „automatisch erkannt, NICHT bestätigt“ markierte Werte sind keine Anforderungen.',
        'Texte des Benutzers sind wörtlich zitiert.',
      ].join('\n'),
    references: 'Referenzen',
    project: 'Projekt',
    uiId: 'UI-ID',
    uiPath: 'UI-Pfad',
    uiVersion: 'UI-Version',
    firstVersion: 'erste Version dieser UI',
    predecessor: (v) => `Vorgänger V${String(v['versionNo'])} (\`${String(v['id'])}\`)`,
    baseVersion: (v) => `basiert auf V${String(v['versionNo'])} (\`${String(v['id'])}\`)`,
    rebased: (v) => `Basis aktualisiert von V${String(v['from'])} auf V${String(v['to'])}`,
    specRevision: 'Spezifikationsrevision',
    generator: 'Prompt-Generator',
    releasedLabel: 'Freigegeben',
    released: (v) => `${String(v['at'])} durch ${String(v['by'])}`,
    session: 'Session',
    agentSession: 'Agenten-Session',
    projectContext: 'Projektkontext',
    uiDescription: 'Zu dieser UI',
    goal: 'Implementierungsziel',
    changeDescription: 'Änderungsbeschreibung',
    changeSummary: 'Zusammenfassung der Änderungen',
    screenshots: 'Referenz-Screenshots',
    primary: 'primäre Referenz',
    variant: 'Variante',
    pixels: (v) => `${String(v['width'])}×${String(v['height'])} px`,
    viewport: (v) => `Viewport ${String(v['width'])}×${String(v['height'])}`,
    coordinatesNote:
      'Regionen sind in Pixeln des Original-Screenshots angegeben (x, y, Breite × Höhe, Ursprung oben links).',
    componentTree: 'Komponentenbaum',
    regionLabel: 'Region',
    noComponents: 'Keine Komponenten.',
    region: (v) =>
      `\`${String(v['screenshot'])}\`: x ${String(v['x'])}, y ${String(v['y'])}, ${String(v['width'])}×${String(v['height'])}`,
    noRegionOn: (v) => `keine Region auf \`${String(v['screenshot'])}\``,
    componentDescriptions: 'Komponentenbeschreibungen',
    visual: 'Visuelle Beschreibung',
    layout: 'Layoutregeln',
    functional: 'Funktionale Anforderungen',
    interaction: 'Interaktionszustände',
    responsive: 'Responsives Verhalten',
    responsiveVariants: 'Regionen je Screenshot-Variante',
    relations: 'Beziehungen zwischen Komponenten',
    acceptance: 'Akzeptanzkriterien',
    globalAcceptance: 'Global',
    globalAcceptanceHeading: 'Globale Akzeptanzkriterien',
    componentAcceptance: 'Je Komponente',
    openPoints: 'Offene Fragen und Einschränkungen',
    openQuestions: 'Offene Fragen',
    acknowledgedWarnings: 'Freigegeben mit diesen bestätigten offenen Punkten',
    resolvedConflicts: 'Aufgelöste Widersprüche',
    resolution: 'Auflösung',
    unspecifiedSummary: (v) =>
      `${String(v['specified'])} von ${String(v['total'])} Komponentenfeldern sind spezifiziert, alle übrigen sind nicht spezifiziert.`,
    unspecifiedFields: 'Nicht spezifiziert',
    unspecifiedFor: 'Nicht spezifiziert für',
    note: 'Hinweis',
    components: 'Komponenten',
    overview: 'Überblick',
    completeness: 'Vollständigkeit',
    completenessCounts: (v) =>
      `${String(v['components'])} Komponenten, ${String(v['specified'])} von ${String(v['total'])} Feldern spezifiziert.`,
    blockingNone: 'Keine blockierenden Punkte.',
    conflicts: 'Widersprüche',
    kind: 'Typ',
    parent: 'Übergeordnet',
    root: 'oberste Ebene',
    changesTitle: (v) => `Änderungen gegenüber V${String(v['versionNo'])}`,
    changesIntro: (v) =>
      `V${String(v['versionNo'])} gilt als umgesetzt. Setze die hier aufgeführten Unterschiede um; für alles Weitere bleibt die vollständige Spezifikation unten maßgeblich.`,
    changesIntroUndelivered: (v) =>
      `V${String(v['versionNo'])} wurde nie als an einen Agenten ausgeliefert vermerkt und ist daher möglicherweise nicht umgesetzt. Die hier aufgeführten Unterschiede dienen nur der Orientierung – setze die vollständige Spezifikation unten um.`,
    confirmedFields: (v) =>
      `Bestätigt, Text unverändert (in V${String(v['versionNo'])} nur automatisch erkannt, jetzt Anforderung): ${String(v['fields'])}`,
    noDifferences: (v) => `Keine spezifizierten Unterschiede zu V${String(v['versionNo'])}.`,
    addedComponents: 'Neue Komponenten',
    changedComponents: 'Geänderte Komponenten',
    removedComponents: 'Entfernte Komponenten (aus der UI entfernen)',
    unchangedComponents: 'Unveränderte Komponenten (bestehende Anforderungen, beibehalten)',
    renamed: (v) => `Umbenannt: „${String(v['before'])}“ → „${String(v['after'])}“`,
    kindChanged: (v) => `Typ: ${String(v['before'])} → ${String(v['after'])}`,
    parentChanged: (v) => `In der Hierarchie verschoben: ${String(v['before'])} → ${String(v['after'])}`,
    reordered: 'Reihenfolge unter den Geschwistern geändert',
    regionChanged: (v) =>
      `Region (${String(v['device'])}, ${String(v['what'])}): x ${String(v['bx'])}, y ${String(v['by'])}, ${String(v['bw'])}×${String(v['bh'])} → x ${String(v['ax'])}, y ${String(v['ay'])}, ${String(v['aw'])}×${String(v['ah'])}`,
    moved: 'verschoben',
    resized: 'Größe geändert',
    before: 'vorher',
    after: 'nachher',
    seeBelow: 'unten vollständig beschrieben',
    relationsAdded: 'Hinzugefügte Beziehungen',
    relationsRemoved: 'Entfernte Beziehungen',
    relationsChanged: 'Geänderte Beziehungen',
    goalChanged: 'Implementierungsziel geändert',
    acceptanceAdded: 'Hinzugefügte globale Akzeptanzkriterien',
    acceptanceRemoved: 'Entfernte globale Akzeptanzkriterien',
    questionsAdded: 'Hinzugefügte offene Fragen',
    questionsRemoved: 'Entfernte offene Fragen',
  },
};

export const LABELS: Readonly<Record<PromptLanguage, Labels>> = { en, de };
