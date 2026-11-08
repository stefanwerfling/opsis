import { describe, expect, it } from 'vitest';
import { transferRect } from './revision.js';

describe('transferRect', () => {
  it('keeps the rect for screenshots of the same width', () => {
    expect(
      transferRect(
        { x: 10, y: 500, width: 100, height: 40 },
        { width: 1200, height: 800 },
        { width: 1200, height: 2400 },
      ),
    ).toEqual({ x: 10, y: 500, width: 100, height: 40 });
  });

  it('scales by the width ratio and clamps to the new image', () => {
    expect(
      transferRect(
        { x: 100, y: 100, width: 400, height: 200 },
        { width: 1200, height: 800 },
        { width: 600, height: 400 },
      ),
    ).toEqual({ x: 50, y: 50, width: 200, height: 100 });
    expect(
      transferRect(
        { x: 0, y: 700, width: 1200, height: 100 },
        { width: 1200, height: 800 },
        { width: 1200, height: 720 },
      ),
    ).toEqual({ x: 0, y: 700, width: 1200, height: 20 });
  });
});
