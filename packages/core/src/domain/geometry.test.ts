import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  MIN_SCALE,
  clampRect,
  clampScale,
  fitViewport,
  handlePoints,
  moveRectWithin,
  rectArea,
  rectContains,
  rectFromPoints,
  resizeRect,
  translateRect,
  imageToStage,
  panBy,
  stageToImage,
  wheelZoomFactor,
  zoomAt,
  zoomStep,
  type Viewport,
} from './geometry.js';

const expectPoint = (actual: { x: number; y: number }, x: number, y: number) => {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
};

describe('viewport transforms', () => {
  const viewports: Viewport[] = [
    { scale: 1, x: 0, y: 0 },
    { scale: 0.37, x: 120.5, y: -40 },
    { scale: 4, x: -3000, y: -12000 },
  ];

  it.each(viewports)('stageToImage inverts imageToStage (%o)', (viewport) => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 2559, y: 14999 },
      { x: 17.25, y: 3.5 },
    ]) {
      const roundTrip = stageToImage(viewport, imageToStage(viewport, point));
      expectPoint(roundTrip, point.x, point.y);
    }
  });

  it('maps with scale and offset', () => {
    expectPoint(imageToStage({ scale: 0.5, x: 10, y: 20 }, { x: 100, y: 200 }), 60, 120);
  });
});

describe('zoomAt', () => {
  it('keeps the image point under the anchor fixed at every zoom level', () => {
    let viewport: Viewport = { scale: 0.25, x: 33, y: -500 };
    const anchor = { x: 412, y: 287 };
    const before = stageToImage(viewport, anchor);
    for (const scale of [0.5, 1, 2.7, 8, 0.05]) {
      viewport = zoomAt(viewport, anchor, scale);
      const after = stageToImage(viewport, anchor);
      expectPoint(after, before.x, before.y);
    }
  });

  it('clamps the scale', () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 1000).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 0).scale).toBe(MIN_SCALE);
  });

  it('zoomStep in and out returns to the original viewport', () => {
    const start: Viewport = { scale: 0.8, x: 10, y: 20 };
    const anchor = { x: 300, y: 200 };
    const back = zoomStep(zoomStep(start, anchor, 'in'), anchor, 'out');
    expect(back.scale).toBeCloseTo(start.scale, 9);
    expectPoint(back, start.x, start.y);
  });
});

describe('clampScale / wheelZoomFactor / panBy', () => {
  it('handles invalid scales', () => {
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
    expect(clampScale(-1)).toBe(MIN_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MIN_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it('zooms in for negative wheel deltas and caps large deltas', () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(10_000)).toBe(wheelZoomFactor(100));
    expect(wheelZoomFactor(-40) * wheelZoomFactor(40)).toBeCloseTo(1, 12);
  });

  it('pans without changing the scale', () => {
    expect(panBy({ scale: 2, x: 1, y: 2 }, 10, -5)).toEqual({ scale: 2, x: 11, y: -3 });
  });
});

describe('fitViewport', () => {
  const stage = { width: 1000, height: 800 };

  it('contains and centres a large image', () => {
    const viewport = fitViewport({ width: 1920, height: 1080 }, stage, 'contain', 0);
    expect(viewport.scale).toBeCloseTo(1000 / 1920, 9);
    expect(viewport.x).toBeCloseTo(0, 9);
    expect(viewport.y).toBeCloseTo((800 - 1080 * viewport.scale) / 2, 9);
  });

  it('fits a long full-page screenshot to the width, top aligned', () => {
    const viewport = fitViewport({ width: 2560, height: 15000 }, stage, 'width', 16);
    expect(viewport.scale).toBeCloseTo((1000 - 32) / 2560, 9);
    expect(viewport.y).toBe(16);
    expectPoint(imageToStage(viewport, { x: 2560, y: 0 }), 1000 - 16, 16);
  });

  it('contain uses the limiting dimension for tall images', () => {
    const viewport = fitViewport({ width: 390, height: 8000 }, stage, 'contain', 0);
    expect(viewport.scale).toBeCloseTo(800 / 8000, 9);
  });

  it('never enlarges small images beyond 100 %', () => {
    const viewport = fitViewport({ width: 200, height: 100 }, stage, 'contain');
    expect(viewport.scale).toBe(1);
    expect(viewport.x).toBe(400);
    expect(viewport.y).toBe(350);
  });

  it('returns the identity for empty sizes', () => {
    expect(fitViewport({ width: 0, height: 10 }, stage, 'contain')).toEqual({ scale: 1, x: 0, y: 0 });
    expect(fitViewport({ width: 10, height: 10 }, { width: 0, height: 0 }, 'width')).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });
});

describe('rectangles', () => {
  const image = { width: 1000, height: 800 };

  it('clampRect snaps to pixels and keeps the rectangle inside the image', () => {
    expect(clampRect({ x: 10.4, y: 10.6, width: 20.2, height: 5 }, image)).toEqual({
      x: 10,
      y: 11,
      width: 21,
      height: 5,
    });
    expect(clampRect({ x: -50, y: -50, width: 100, height: 100 }, image)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    expect(clampRect({ x: 990, y: 790, width: 100, height: 100 }, image)).toEqual({
      x: 990,
      y: 790,
      width: 10,
      height: 10,
    });
    // completely outside or degenerate → at least one pixel, inside
    expect(clampRect({ x: 5000, y: 5000, width: 0, height: 0 }, image)).toEqual({
      x: 999,
      y: 799,
      width: 1,
      height: 1,
    });
  });

  it('rectFromPoints works in every drag direction', () => {
    const expected = { x: 10, y: 20, width: 30, height: 40 };
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected);
    expect(rectFromPoints({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected);
    expect(rectFromPoints({ x: 40, y: 20 }, { x: 10, y: 60 })).toEqual(expected);
  });

  it('resizeRect moves only the dragged edges and flips instead of going negative', () => {
    const rect = { x: 100, y: 100, width: 50, height: 40 };
    expect(resizeRect(rect, 'se', 10, 5)).toEqual({ x: 100, y: 100, width: 60, height: 45 });
    expect(resizeRect(rect, 'nw', 10, 5)).toEqual({ x: 110, y: 105, width: 40, height: 35 });
    expect(resizeRect(rect, 'n', 99, 5)).toEqual({ x: 100, y: 105, width: 50, height: 35 });
    expect(resizeRect(rect, 'e', -80, 0)).toEqual({ x: 70, y: 100, width: 30, height: 40 });
  });

  it('moveRectWithin keeps size and stays inside', () => {
    const rect = { x: 900, y: 10, width: 80, height: 20 };
    expect(moveRectWithin(rect, 50, -50, image)).toEqual({ x: 920, y: 0, width: 80, height: 20 });
    expect(translateRect(rect, 50, -50)).toEqual({ x: 950, y: -40, width: 80, height: 20 });
  });

  it('hit testing and handles use the same coordinate space', () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(rectContains(rect, { x: 10, y: 20 })).toBe(true);
    expect(rectContains(rect, { x: 40, y: 60 })).toBe(true);
    expect(rectContains(rect, { x: 41, y: 60 })).toBe(false);
    expect(rectArea(rect)).toBe(1200);
    expect(handlePoints(rect).se).toEqual({ x: 40, y: 60 });
    expect(handlePoints(rect).n).toEqual({ x: 25, y: 20 });
  });

  it('a region keeps its image position at every zoom level', () => {
    const region = { x: 200, y: 300, width: 50, height: 20 };
    for (const viewport of [
      { scale: 0.1, x: 5, y: 7 },
      { scale: 3.3, x: -800, y: -1200 },
    ]) {
      const topLeft = imageToStage(viewport, region);
      const back = stageToImage(viewport, topLeft);
      expect(back.x).toBeCloseTo(region.x, 9);
      expect(back.y).toBeCloseTo(region.y, 9);
    }
  });
});
