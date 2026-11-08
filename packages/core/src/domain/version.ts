/**
 * Immutable history records created by a release (architecture 02, 05). Once written,
 * they are never changed or deleted – the database enforces this with triggers.
 */
import type { CompletenessReport } from './completeness.js';
import type { Timestamp } from './common.js';

export interface UiVersion {
  readonly id: string;
  readonly projectId: string;
  readonly uiViewId: string;
  readonly versionNo: number;
  /** Primary reference screenshot. */
  readonly screenshotId: string;
  /** All screenshot variants of the version, primary first. */
  readonly screenshotIds: readonly string[];
  readonly specRevisionId: string;
  readonly promptVersionId: string;
  readonly sessionId: string;
  readonly predecessorVersionId: string | null;
  readonly pathAtVersion: string;
  readonly changeDescription: string;
  readonly createdBy: string;
  readonly createdAt: Timestamp;
}

export interface SpecRevision {
  readonly id: string;
  readonly projectId: string;
  readonly uiViewId: string;
  readonly sessionId: string;
  readonly revisionNo: number;
  /** Canonical JSON of the SpecSnapshot. */
  readonly snapshot: string;
  readonly snapshotSha256: string;
  readonly completeness: CompletenessReport;
  readonly acknowledgedIssues: readonly string[];
  readonly previousSpecRevisionId: string | null;
  readonly releasedBy: string;
  readonly releasedAt: Timestamp;
}

export interface ComponentRevision {
  readonly id: string;
  readonly componentId: string;
  readonly contentSha256: string;
  /** Canonical JSON of name, kind, spec and regions. */
  readonly content: string;
  readonly createdAt: Timestamp;
}

/** Tree position of a component revision within a spec revision. */
export interface SpecRevisionComponent {
  readonly specRevisionId: string;
  readonly componentRevisionId: string;
  readonly componentId: string;
  readonly parentComponentId: string | null;
  readonly order: number;
}

export interface PromptVersion {
  readonly id: string;
  readonly specRevisionId: string;
  readonly generatorVersion: string;
  readonly markdown: string;
  readonly sha256: string;
  readonly createdAt: Timestamp;
}
