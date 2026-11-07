import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  fitViewport,
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
