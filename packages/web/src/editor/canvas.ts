import {
  clampRect,
  handlePoints,
  imageToStage,
  moveRectWithin,
  rectArea,
  rectContains,
  rectFromPoints,
  regionOn,
  resizeRect,
  RESIZE_HANDLES,
  type DraftOperation,
  type Point,
  type Rect,
  type ResizeHandle,
  type Viewport,
  depthColor,
} from '@opsis/core/browser';
import type { CanvasInteraction, ScreenshotViewer } from '../components/viewer.js';
import type { Editor } from './editor.js';

/** Hit tolerance for resize handles, in CSS pixels. */
const HANDLE_HIT_PX = 7;
const HANDLE_SIZE_PX = 7;
/** Below this pointer travel (CSS px) a press counts as a click, not a drag. */
const CLICK_TOLERANCE_PX = 3;
/** Smallest new region (image px); smaller drags are treated as clicks. */
const MIN_NEW_REGION_PX = 3;

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

type Gesture =
  | { kind: 'draw'; start: Point; current: Point }
  | {
      kind: 'move';
      start: Point;
      current: Point;
      originals: Map<string, Rect>;
      clickTarget: string | null;
      additive: boolean;
    }
  | {
      kind: 'resize';
      start: Point;
      current: Point;
      componentId: string;
      handle: ResizeHandle;
      original: Rect;
    }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean }
  | { kind: 'relate'; start: Point; current: Point; fromComponentId: string };

/**
 * Canvas interaction of the component editor. While dragging, only a preview is drawn;
 * the draft changes once on pointer up (one operation batch per gesture).
 */
export class EditorCanvas implements CanvasInteraction {
  private gesture: Gesture | null = null;
  /** Last click position and hit list, for cycling through overlapping regions. */
  private lastClick: { point: Point; hits: string[] } | null = null;

  constructor(
    private readonly editor: Editor,
    private readonly viewer: ScreenshotViewer,
  ) {
    viewer.interaction = this;
    viewer.overlay = (context, viewport) => {
      this.draw(context, viewport);
    };
  }

  // ── Geometry helpers ────────────────────────────────────────────────────────

  private scale(): number {
    return this.viewer.currentViewport.scale;
  }

  /** Visible regions on the active screenshot, in tree order (parents first). */
  private regions(): { componentId: string; rect: Rect }[] {
    const screenshot = this.editor.activeScreenshot;
    if (screenshot === null) return [];
    const hidden = new Set<string>();
    const result: { componentId: string; rect: Rect }[] = [];
    for (const component of this.editor.draft.components) {
      // Hiding a component hides its whole subtree in the editor.
      if (component.hidden || (component.parentId !== null && hidden.has(component.parentId))) {
        hidden.add(component.componentId);
        continue;
      }
      const region = regionOn(component, screenshot.id);
      if (region) result.push({ componentId: component.componentId, rect: region });
    }
    return result;
  }

  /** Regions under the point, smallest (innermost) first. */
  private hitsAt(point: Point): string[] {
    return this.regions()
      .filter((region) => rectContains(region.rect, point))
      .sort((a, b) => rectArea(a.rect) - rectArea(b.rect))
      .map((region) => region.componentId);
  }

  private handleAt(point: Point): { componentId: string; handle: ResizeHandle; rect: Rect } | null {
    const single = this.editor.single;
    const screenshot = this.editor.activeScreenshot;
    if (!single || screenshot === null || this.editor.readOnly) return null;
    const region = regionOn(single, screenshot.id);
    if (!region) return null;
    const tolerance = HANDLE_HIT_PX / this.scale();
    const handles = handlePoints(region);
    for (const handle of RESIZE_HANDLES) {
      const position = handles[handle];
      if (Math.abs(position.x - point.x) <= tolerance && Math.abs(position.y - point.y) <= tolerance) {
        return { componentId: single.componentId, handle, rect: region };
      }
    }
    return null;
  }

  private travelled(gesture: Gesture): number {
    return (
      Math.hypot(gesture.current.x - gesture.start.x, gesture.current.y - gesture.start.y) * this.scale()
    );
  }

  // ── CanvasInteraction ───────────────────────────────────────────────────────

  pointerDown(event: PointerEvent, point: Point): boolean {
    const editor = this.editor;
    if (editor.activeScreenshot === null || event.button !== 0) return false;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;

    if (editor.tool === 'relate') {
      const from = this.hitsAt(point)[0];
      if (from === undefined) return false;
      this.gesture = { kind: 'relate', start: point, current: point, fromComponentId: from };
      return true;
    }
    if (editor.tool === 'draw' || editor.tool === 'region') {
      this.gesture = { kind: 'draw', start: point, current: point };
      return true;
    }
    const handle = this.handleAt(point);
    if (handle) {
      this.gesture = { kind: 'resize', start: point, current: point, ...handle, original: handle.rect };
      return true;
    }
    const hits = this.hitsAt(point);
    if (hits.length === 0) {
      if (additive) {
        this.gesture = { kind: 'marquee', start: point, current: point, additive: true };
        return true;
      }
      if (editor.selection.length > 0) editor.select([]);
      return false; // empty area: pan
    }
    // Drag the selection if the press is on a selected region (lets you move a parent that
    // is covered by children); otherwise the innermost region becomes the target.
    const selectedHit = hits.find((id) => editor.isSelected(id));
    const target = selectedHit ?? hits[0] ?? null;
    if (target !== null && selectedHit === undefined && !additive) editor.select([target]);
    const screenshot = editor.activeScreenshot;
    const originals = new Map<string, Rect>();
    const movable = editor.readOnly
      ? []
      : editor.isSelected(target ?? '')
        ? editor.selection
        : target
          ? [target]
          : [];
    for (const id of movable) {
      const component = editor.draft.components.find((candidate) => candidate.componentId === id);
      const region = component ? regionOn(component, screenshot.id) : undefined;
      if (region) originals.set(id, region);
    }
    this.gesture = {
      kind: 'move',
      start: point,
      current: point,
      originals,
      clickTarget: target,
      additive,
    };
    return true;
  }

  pointerMove(_event: PointerEvent, point: Point, dragging: boolean): void {
    if (dragging && this.gesture) {
      this.gesture.current = point;
      this.viewer.requestDraw();
      return;
    }
    const hover = this.hitsAt(point)[0] ?? null;
    if (hover !== this.editor.hoverId) {
      this.editor.hoverId = hover;
      this.viewer.requestDraw();
    }
  }

  pointerUp(_event: PointerEvent, point: Point): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture) return;
    gesture.current = point;
    const editor = this.editor;
    const screenshot = editor.activeScreenshot;
    if (screenshot === null) return;
    const isClick = this.travelled(gesture) < CLICK_TOLERANCE_PX;

    switch (gesture.kind) {
      case 'draw': {
        const rect = clampRect(rectFromPoints(gesture.start, gesture.current), screenshot);
        if (isClick || rect.width < MIN_NEW_REGION_PX || rect.height < MIN_NEW_REGION_PX) break;
        const single = editor.single;
        if (editor.tool === 'region' && single) {
          editor.setRegion(single.componentId, rect);
          editor.setTool('select');
        } else {
          editor.addComponent(rect);
        }
        break;
      }
      case 'resize': {
        if (isClick) break;
        const rect = clampRect(this.resizedRect(gesture), screenshot);
        editor.setRegion(gesture.componentId, rect);
        break;
      }
      case 'marquee': {
        const area = rectFromPoints(gesture.start, gesture.current);
        const inside = this.regions()
          .filter(
            (region) =>
              rectContains(area, region.rect) &&
              rectContains(area, {
                x: region.rect.x + region.rect.width,
                y: region.rect.y + region.rect.height,
              }),
          )
          .map((region) => region.componentId);
        editor.select(inside, gesture.additive ? 'toggle' : 'replace');
        break;
      }
      case 'relate': {
        const target = this.hitsAt(point).find((id) => id !== gesture.fromComponentId);
        if (target !== undefined) {
          editor.addRelation(gesture.fromComponentId, target);
          editor.setTool('select');
        }
        break;
      }
      case 'move': {
        if (isClick) {
          this.click(point, gesture.clickTarget, gesture.additive);
          break;
        }
        const operations: DraftOperation[] = [];
        for (const [componentId, rect] of gesture.originals) {
          operations.push({
            op: 'setRegion',
            componentId,
            screenshotId: screenshot.id,
            rect: clampRect(this.movedRect(gesture, rect), screenshot),
          });
        }
        editor.apply(...operations);
        break;
      }
    }
    this.viewer.requestDraw();
  }

  /** Click selection with cycling: clicking the same spot again selects the next region below. */
  private click(point: Point, target: string | null, additive: boolean): void {
    const editor = this.editor;
    const hits = this.hitsAt(point);
    if (additive) {
      if (target !== null) editor.select([target], 'toggle');
      this.lastClick = null;
      return;
    }
    const tolerance = CLICK_TOLERANCE_PX / this.scale();
    const last = this.lastClick;
    const samePlace =
      last !== null &&
      Math.abs(last.point.x - point.x) <= tolerance &&
      Math.abs(last.point.y - point.y) <= tolerance &&
      last.hits.join() === hits.join();
    let next = hits[0];
    if (samePlace && editor.single) {
      const index = hits.indexOf(editor.single.componentId);
      next = hits[(index + 1) % hits.length];
    }
    this.lastClick = { point, hits };
    if (next !== undefined) editor.select([next]);
  }

  cursor(point: Point): string | null {
    if (this.editor.tool !== 'select') return 'crosshair';
    const handle = this.handleAt(point);
    if (handle) return HANDLE_CURSORS[handle.handle];
    if (this.hitsAt(point).length > 0) return this.editor.readOnly ? 'pointer' : 'move';
    return null;
  }

  keyDown(event: KeyboardEvent): boolean {
    const editor = this.editor;
    if (event.key === 'Escape') {
      if (this.gesture) this.gesture = null;
      else if (editor.tool !== 'select') editor.setTool('select');
      else editor.select([]);
      this.viewer.requestDraw();
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === 'r') {
      editor.setTool('draw');
      return true;
    }
    if (event.key === 'l') {
      editor.setTool('relate');
      return true;
    }
    if (event.key === 'v') {
      editor.setTool('select');
      return true;
    }
    const nudges: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const nudge = nudges[event.key];
    const screenshot = editor.activeScreenshot;
    if (nudge && screenshot !== null && editor.selection.length > 0 && !editor.readOnly) {
      // Arrow keys move selected regions by 1 px (Shift: 10 px); without selection they pan.
      const step = event.shiftKey ? 10 : 1;
      const operations: DraftOperation[] = [];
      for (const { componentId, rect } of this.regions()) {
        if (!editor.isSelected(componentId)) continue;
        operations.push({
          op: 'setRegion',
          componentId,
          screenshotId: screenshot.id,
          rect: moveRectWithin(rect, nudge.x * step, nudge.y * step, screenshot),
        });
      }
      if (operations.length === 0) return false;
      editor.apply(...operations);
      return true;
    }
    return false;
  }

  // ── Preview geometry ────────────────────────────────────────────────────────

  private movedRect(gesture: Extract<Gesture, { kind: 'move' }>, rect: Rect): Rect {
    const screenshot = this.editor.activeScreenshot;
    const dx = gesture.current.x - gesture.start.x;
    const dy = gesture.current.y - gesture.start.y;
    return screenshot === null ? rect : moveRectWithin(rect, dx, dy, screenshot);
  }

  private resizedRect(gesture: Extract<Gesture, { kind: 'resize' }>): Rect {
    return resizeRect(
      gesture.original,
      gesture.handle,
      gesture.current.x - gesture.start.x,
      gesture.current.y - gesture.start.y,
    );
  }

  /** Region as currently displayed, including an ongoing drag. */
  private displayRect(componentId: string, rect: Rect): Rect {
    const gesture = this.gesture;
    if (
      gesture?.kind === 'move' &&
      gesture.originals.has(componentId) &&
      this.travelled(gesture) >= CLICK_TOLERANCE_PX
    ) {
      return this.movedRect(gesture, rect);
    }
    if (gesture?.kind === 'resize' && gesture.componentId === componentId) return this.resizedRect(gesture);
    return rect;
  }

  // ── Rendering (stage CSS pixels) ────────────────────────────────────────────

  private draw(context: CanvasRenderingContext2D, viewport: Viewport): void {
    const editor = this.editor;
    const depths = editor.depths();
    const toStage = (rect: Rect): Rect => {
      const topLeft = imageToStage(viewport, rect);
      return {
        x: topLeft.x,
        y: topLeft.y,
        width: rect.width * viewport.scale,
        height: rect.height * viewport.scale,
      };
    };
    const names = new Map(
      editor.draft.components.map((component) => [component.componentId, component.name]),
    );
    const centers = new Map<string, Point>();

    context.font = '12px system-ui, sans-serif';
    context.textBaseline = 'top';
    for (const { componentId, rect } of this.regions()) {
      const stage = toStage(this.displayRect(componentId, rect));
      centers.set(componentId, { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 });
      const color = depthColor(depths.get(componentId) ?? 0);
      const selected = editor.isSelected(componentId);
      const hovered = editor.hoverId === componentId;

      if (selected || hovered) {
        context.globalAlpha = selected ? 0.16 : 0.08;
        context.fillStyle = color;
        context.fillRect(stage.x, stage.y, stage.width, stage.height);
        context.globalAlpha = 1;
      }
      context.strokeStyle = color;
      context.lineWidth = selected ? 2.5 : 1.5;
      context.setLineDash([]);
      context.strokeRect(stage.x + 0.5, stage.y + 0.5, stage.width - 1, stage.height - 1);

      // Name label inside the top-left corner, clipped to the region width.
      const label = names.get(componentId) ?? '';
      if (stage.width > 24 && stage.height > 14) {
        const textWidth = Math.min(context.measureText(label).width + 8, stage.width);
        context.fillStyle = color;
        context.fillRect(stage.x, stage.y, textWidth, 16);
        context.save();
        context.beginPath();
        context.rect(stage.x, stage.y, textWidth, 16);
        context.clip();
        context.fillStyle = '#ffffff';
        context.fillText(label, stage.x + 4, stage.y + 2);
        context.restore();
      }
    }

    this.drawRelations(context, centers);
    this.drawHandles(context, toStage);
    this.drawGesture(context, toStage);
    this.drawRelateGesture(context, viewport, centers);
  }

  private drawRelations(context: CanvasRenderingContext2D, centers: Map<string, Point>): void {
    const editor = this.editor;
    context.strokeStyle = '#111111';
    context.fillStyle = '#111111';
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    for (const relation of editor.draft.relations) {
      if (!editor.isSelected(relation.fromComponentId) && !editor.isSelected(relation.toComponentId))
        continue;
      const from = centers.get(relation.fromComponentId);
      const to = centers.get(relation.toComponentId);
      if (!from || !to) continue;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      context.beginPath();
      context.moveTo(to.x, to.y);
      context.lineTo(to.x - 10 * Math.cos(angle - 0.4), to.y - 10 * Math.sin(angle - 0.4));
      context.lineTo(to.x - 10 * Math.cos(angle + 0.4), to.y - 10 * Math.sin(angle + 0.4));
      context.closePath();
      context.fill();
    }
    context.setLineDash([]);
  }

  private drawHandles(context: CanvasRenderingContext2D, toStage: (rect: Rect) => Rect): void {
    const single = this.editor.single;
    const screenshot = this.editor.activeScreenshot;
    if (!single || screenshot === null || this.editor.readOnly) return;
    const region = regionOn(single, screenshot.id);
    if (!region) return;
    const stage = toStage(this.displayRect(single.componentId, region));
    const half = HANDLE_SIZE_PX / 2;
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#111111';
    context.lineWidth = 1;
    for (const position of Object.values(handlePoints(stage))) {
      context.fillRect(position.x - half, position.y - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
      context.strokeRect(
        position.x - half + 0.5,
        position.y - half + 0.5,
        HANDLE_SIZE_PX - 1,
        HANDLE_SIZE_PX - 1,
      );
    }
  }

  /** Arrow from the source region to the pointer while a relation is being dragged. */
  private drawRelateGesture(
    context: CanvasRenderingContext2D,
    viewport: Viewport,
    centers: Map<string, Point>,
  ): void {
    const gesture = this.gesture;
    if (gesture?.kind !== 'relate') return;
    const from = centers.get(gesture.fromComponentId);
    if (!from) return;
    const to = imageToStage(viewport, gesture.current);
    context.strokeStyle = '#111111';
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.setLineDash([]);
  }

  private drawGesture(context: CanvasRenderingContext2D, toStage: (rect: Rect) => Rect): void {
    const gesture = this.gesture;
    if (gesture?.kind !== 'draw' && gesture?.kind !== 'marquee') return;
    const stage = toStage(rectFromPoints(gesture.start, gesture.current));
    context.strokeStyle = '#111111';
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.strokeRect(stage.x + 0.5, stage.y + 0.5, stage.width, stage.height);
    context.strokeStyle = '#ffffff';
    context.lineDashOffset = 4;
    context.strokeRect(stage.x + 0.5, stage.y + 0.5, stage.width, stage.height);
    context.lineDashOffset = 0;
    context.setLineDash([]);
  }
}
