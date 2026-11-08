/**
 * Marks for the annotated screenshot export (architecture 05 §7): the frames and names of
 * all components that have a region on one screenshot, coloured by hierarchy depth – the
 * same colours the editor uses. Pure data; rendering is an infrastructure concern.
 */
import type { SpecSnapshot } from './snapshot.js';

/** Colours by hierarchy depth; repeat for deeper levels. Chosen to stand out on screenshots. */
export const DEPTH_COLORS = [
  '#e8590c',
  '#1c7ed6',
  '#2f9e44',
  '#ae3ec9',
  '#f08c00',
  '#0c8599',
  '#e03131',
  '#5f3dc4',
] as const;

export const depthColor = (depth: number): string => DEPTH_COLORS[depth % DEPTH_COLORS.length] ?? '#e8590c';

export interface AnnotationMark {
  readonly componentId: string;
  readonly name: string;
  readonly depth: number;
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Annotation {
  readonly screenshotId: string;
  readonly width: number;
  readonly height: number;
  /** Tree order (parents before children), so children are drawn on top. */
  readonly marks: readonly AnnotationMark[];
}

export const buildAnnotation = (snapshot: SpecSnapshot, screenshotId: string): Annotation => {
  const screenshot = snapshot.screenshots.find((candidate) => candidate.id === screenshotId);
  if (!screenshot) throw new Error(`Screenshot "${screenshotId}" is not part of this specification`);
  const depths = new Map<string, number>();
  const marks: AnnotationMark[] = [];
  // Snapshot components are in tree order: a parent's depth is known before its children.
  for (const component of snapshot.components) {
    const depth = component.parentId === null ? 0 : (depths.get(component.parentId) ?? -1) + 1;
    depths.set(component.componentId, depth);
    for (const region of component.regions) {
      if (region.screenshotId !== screenshotId) continue;
      marks.push({
        componentId: component.componentId,
        name: component.name,
        depth,
        color: depthColor(depth),
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      });
    }
  }
  return { screenshotId, width: screenshot.width, height: screenshot.height, marks };
};
