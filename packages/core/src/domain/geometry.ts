/**
 * Coordinate geometry between screenshot (image pixels) and the editor stage (CSS pixels).
 *
 * A viewport maps image coordinates to stage coordinates as `stage = image * scale + offset`.
 * The device pixel ratio is deliberately not part of this model: the canvas library renders
 * at `devicePixelRatio` internally, all pointer events arrive in CSS pixels. Region data is
 * always stored in image pixels, so it is independent of zoom, pan and display density.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 8;
/** Factor for one zoom step (button, keyboard). */
export const ZOOM_STEP = 1.25;

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, x: 0, y: 0 };

export const clampScale = (scale: number): number => {
  if (!Number.isFinite(scale) || scale <= 0) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
};

export const imageToStage = (viewport: Viewport, point: Point): Point => ({
  x: point.x * viewport.scale + viewport.x,
  y: point.y * viewport.scale + viewport.y,
});

export const stageToImage = (viewport: Viewport, point: Point): Point => ({
  x: (point.x - viewport.x) / viewport.scale,
  y: (point.y - viewport.y) / viewport.scale,
});

/** Changes the scale while the image point under `anchor` (stage coordinates) stays in place. */
export const zoomAt = (viewport: Viewport, anchor: Point, nextScale: number): Viewport => {
  const scale = clampScale(nextScale);
  const imagePoint = stageToImage(viewport, anchor);
  return { scale, x: anchor.x - imagePoint.x * scale, y: anchor.y - imagePoint.y * scale };
};

/** One zoom step in or out, anchored at `anchor` (usually the stage centre). */
export const zoomStep = (viewport: Viewport, anchor: Point, direction: 'in' | 'out'): Viewport =>
  zoomAt(viewport, anchor, direction === 'in' ? viewport.scale * ZOOM_STEP : viewport.scale / ZOOM_STEP);

/**
 * Converts a wheel delta into a zoom factor. Exponential, so that trackpads (many small
 * deltas) and mouse wheels (few large deltas) zoom equally fast; capped per event.
 */
export const wheelZoomFactor = (deltaY: number): number => {
  const capped = Math.max(-100, Math.min(100, deltaY));
  return Math.exp(-capped * 0.0025);
};

export const panBy = (viewport: Viewport, dx: number, dy: number): Viewport => ({
  ...viewport,
  x: viewport.x + dx,
  y: viewport.y + dy,
});

export type FitMode = 'contain' | 'width';

/**
 * Viewport that shows the whole image (`contain`, centred) or fills the width
 * (`width`, top aligned – useful for long full-page screenshots). Never enlarges beyond 100 %.
 */
export const fitViewport = (image: Size, stage: Size, mode: FitMode, padding = 16): Viewport => {
  if (image.width <= 0 || image.height <= 0 || stage.width <= 0 || stage.height <= 0) {
    return IDENTITY_VIEWPORT;
  }
  const availableWidth = Math.max(1, stage.width - 2 * padding);
  const availableHeight = Math.max(1, stage.height - 2 * padding);
  const widthScale = availableWidth / image.width;
  const fitted = mode === 'width' ? widthScale : Math.min(widthScale, availableHeight / image.height);
  const scale = clampScale(Math.min(1, fitted));
  const x = (stage.width - image.width * scale) / 2;
  const y = mode === 'width' ? padding : (stage.height - image.height * scale) / 2;
  return { scale, x, y };
};
