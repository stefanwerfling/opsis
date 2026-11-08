/**
 * The released specification as an immutable snapshot (architecture 05 §2, step 5).
 *
 * Everything the generators need is copied in, so a snapshot can be rendered again at any
 * time without reading mutable data (historical reconstruction, 05 §6). It contains no
 * release references (version numbers, ids, time): those are assigned by the release and
 * passed to the generators separately, so the snapshot hash depends on content only.
 */
import type { CompletenessReport } from '../completeness.js';
import type { ComponentSpec, Conflict, Draft, Region, Relation } from '../draft.js';
import type { Project } from '../project.js';
import type { Screenshot } from '../screenshot.js';
import type { Session } from '../session.js';
import type { UiView } from '../ui-view.js';
import type { ComponentKind, DeviceCategory, ImageMimeType, PromptLanguage } from '../vocabulary.js';

export const SNAPSHOT_FORMAT = 'opsis-spec-snapshot/v1';

export interface SnapshotScreenshot {
  readonly id: string;
  readonly sequenceNo: number;
  readonly mimeType: ImageMimeType;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly viewportWidth: number | null;
  readonly viewportHeight: number | null;
  readonly deviceCategory: DeviceCategory;
  readonly variantLabel: string | null;
  readonly capturedAt: string | null;
  readonly description: string;
}

/** A component without editor-only state (`hidden` has no domain meaning). */
export interface SnapshotComponent {
  readonly componentId: string;
  readonly parentId: string | null;
  readonly order: number;
  readonly name: string;
  readonly kind: ComponentKind;
  readonly spec: ComponentSpec;
  readonly regions: readonly Region[];
}

export interface VersionRef {
  readonly id: string;
  readonly versionNo: number;
}

export interface SpecSnapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly project: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly description: string;
    readonly promptLanguage: PromptLanguage;
  };
  readonly uiView: {
    readonly id: string;
    readonly uiId: string;
    readonly path: string;
    readonly name: string;
    readonly description: string;
  };
  readonly session: {
    readonly id: string;
    readonly title: string;
    readonly intent: 'create' | 'revise';
    readonly agentId: string | null;
    readonly agentSessionRef: string | null;
  };
  /** Version the session was based on (revisions); null for the first version. */
  readonly baseVersion: VersionRef | null;
  readonly primaryScreenshotId: string;
  readonly screenshots: readonly SnapshotScreenshot[];
  readonly goal: string;
  readonly changeSummary: string;
  readonly acceptance: readonly string[];
  readonly openQuestions: readonly string[];
  /** Tree order: parents before children, siblings by order. */
  readonly components: readonly SnapshotComponent[];
  readonly relations: readonly Relation[];
  readonly conflicts: readonly Conflict[];
  readonly completeness: CompletenessReport;
  /** Warning ids the human acknowledged when releasing ("release with open points"). */
  readonly acknowledgedWarnings: readonly string[];
}

/** Ids and numbers assigned by the release; referenced by spec JSON and prompt. */
export interface ReleaseReferences {
  readonly uiVersionId: string;
  readonly versionNo: number;
  readonly specRevisionId: string;
  readonly revisionNo: number;
  readonly predecessor: VersionRef | null;
  readonly releasedAt: string;
  readonly releasedBy: string;
  readonly changeDescription: string;
}

export interface SnapshotInput {
  readonly project: Project;
  readonly uiView: UiView;
  readonly session: Session;
  readonly baseVersion: VersionRef | null;
  /** Screenshots of the session; the first by sequence number is the primary one. */
  readonly screenshots: readonly Screenshot[];
  readonly draft: Draft;
  readonly completeness: CompletenessReport;
  readonly acknowledgedWarnings: readonly string[];
}

export const buildSnapshot = (input: SnapshotInput): SpecSnapshot => {
  const screenshots = [...input.screenshots].sort((a, b) => a.sequenceNo - b.sequenceNo);
  const primary = screenshots[0];
  if (!primary) throw new Error('A specification needs at least one screenshot');
  const { project, uiView, session, draft } = input;
  return {
    format: SNAPSHOT_FORMAT,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description,
      promptLanguage: project.promptLanguage,
    },
    uiView: {
      id: uiView.id,
      uiId: uiView.uiId,
      path: uiView.path,
      name: uiView.name,
      description: uiView.description,
    },
    session: {
      id: session.id,
      title: session.title,
      intent: session.intent,
      agentId: session.agentId,
      agentSessionRef: session.agentSessionRef,
    },
    baseVersion: input.baseVersion,
    primaryScreenshotId: primary.id,
    screenshots: screenshots.map((screenshot) => ({
      id: screenshot.id,
      sequenceNo: screenshot.sequenceNo,
      mimeType: screenshot.mimeType,
      sha256: screenshot.blobSha256,
      width: screenshot.width,
      height: screenshot.height,
      viewportWidth: screenshot.viewportWidth,
      viewportHeight: screenshot.viewportHeight,
      deviceCategory: screenshot.deviceCategory,
      variantLabel: screenshot.variantLabel,
      capturedAt: screenshot.capturedAt,
      description: screenshot.description,
    })),
    goal: draft.goal,
    changeSummary: draft.changeSummary,
    acceptance: draft.acceptance,
    openQuestions: draft.openQuestions,
    components: draft.components.map((component) => ({
      componentId: component.componentId,
      parentId: component.parentId,
      order: component.order,
      name: component.name,
      kind: component.kind,
      spec: component.spec,
      regions: component.regions,
    })),
    relations: draft.relations,
    conflicts: draft.conflicts,
    completeness: input.completeness,
    acknowledgedWarnings: [...new Set(input.acknowledgedWarnings)].sort(),
  };
};

/** Content of a component revision (architecture 05 §2, step 4): hierarchy is stored separately. */
export const componentContent = (
  component: SnapshotComponent,
): Pick<SnapshotComponent, 'name' | 'kind' | 'spec' | 'regions'> => ({
  name: component.name,
  kind: component.kind,
  spec: component.spec,
  regions: component.regions,
});

export const SPECIFICATION_FORMAT = 'opsis-specification/v1';

/** Machine-readable specification (output 1 of requirements §10): references + snapshot. */
export const buildSpecificationDocument = (
  snapshot: SpecSnapshot,
  references: ReleaseReferences,
  generatorVersion: string,
) => ({
  format: SPECIFICATION_FORMAT,
  generatorVersion,
  references: {
    projectId: snapshot.project.id,
    uiViewId: snapshot.uiView.id,
    uiId: snapshot.uiView.uiId,
    uiPath: snapshot.uiView.path,
    ...references,
    screenshotIds: snapshot.screenshots.map((screenshot) => screenshot.id),
    primaryScreenshotId: snapshot.primaryScreenshotId,
  },
  specification: snapshot,
});
