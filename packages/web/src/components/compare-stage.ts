import type { Annotation } from '@opsis/core/browser';
import { h, replaceChildren, type Child } from '../dom.js';

const SVG = 'http://www.w3.org/2000/svg';

export interface StageImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly annotation: Annotation;
}

export type CompareMode = 'overlay' | 'wipe' | 'side' | 'pixel';

const svg = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string | number>>,
  text?: string,
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
};

/**
 * Component frames of one version as SVG in image coordinates, stretched over the image.
 * `dashed` distinguishes version A from B when both are shown.
 */
export const framesOverlay = (image: StageImage, dashed: boolean): SVGSVGElement => {
  const { width, height } = image;
  const root = svg('svg', {
    class: 'frames',
    viewBox: `0 0 ${String(width)} ${String(height)}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  const fontSize = Math.max(12, Math.round(width / 90));
  for (const mark of image.annotation.marks) {
    root.append(
      svg('rect', {
        x: mark.x,
        y: mark.y,
        width: mark.width,
        height: mark.height,
        fill: 'none',
        stroke: mark.color,
        'stroke-width': 2,
        'vector-effect': 'non-scaling-stroke',
        ...(dashed ? { 'stroke-dasharray': '6 4' } : {}),
      }),
      svg(
        'text',
        {
          x: mark.x + 4,
          y: mark.y + fontSize,
          fill: mark.color,
          'font-size': fontSize,
          'font-weight': 'bold',
          'paint-order': 'stroke',
          stroke: '#ffffff',
          'stroke-width': Math.max(2, fontSize / 5),
        },
        mark.name,
      ),
    );
  }
  return root;
};

/** An image with optional frames; the frames scale with the image. */
export const framedImage = (image: StageImage, frames: boolean, dashed = false): HTMLElement =>
  h(
    'div',
    { class: 'framed' },
    h('img', { attrs: { src: image.url, alt: '', width: image.width, height: image.height } }),
    frames && framesOverlay(image, dashed),
  );

export interface StageOptions {
  readonly mode: Exclude<CompareMode, 'pixel'>;
  readonly frames: boolean;
  /** Overlay: opacity of B (0–1). Wipe: position of the divider (0–1). */
  readonly amount: number;
}

/**
 * Visual comparison of two screenshots: B is laid over A at A's width (sizes may differ),
 * either transparent (overlay) or cut at a divider (wipe), or both next to each other.
 */
export const compareStage = (a: StageImage, b: StageImage, options: StageOptions): HTMLElement => {
  if (options.mode === 'side') {
    return h(
      'div',
      { class: 'compare side' },
      h('figure', {}, h('figcaption', {}, 'A'), framedImage(a, options.frames, true)),
      h('figure', {}, h('figcaption', {}, 'B'), framedImage(b, options.frames)),
    );
  }
  const top = framedImage(b, options.frames);
  top.classList.add('top');
  if (options.mode === 'overlay') top.style.opacity = String(options.amount);
  else top.style.clipPath = `inset(0 0 0 ${String(Math.round(options.amount * 1000) / 10)}%)`;
  const children: Child[] = [framedImage(a, options.frames, true), top];
  if (options.mode === 'wipe') {
    const divider = h('div', { class: 'divider' });
    divider.style.left = `${String(options.amount * 100)}%`;
    children.push(divider);
  }
  const stage = h('div', { class: `compare ${options.mode}` });
  replaceChildren(stage, children);
  return stage;
};
