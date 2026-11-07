import {
  fitViewport,
  panBy,
  wheelZoomFactor,
  zoomAt,
  zoomStep,
  type FitMode,
  type Point,
  type Size,
  type Viewport,
} from '@opsis/core/browser';
import { h, replaceChildren } from '../dom.js';
import { t } from '../i18n/i18n.js';

/** Line height used to convert `WheelEvent.DOM_DELTA_LINE` into pixels. */
const LINE_HEIGHT_PX = 16;
/** Above this zoom level pixels are shown sharp (no smoothing) for exact inspection. */
const PIXELATED_FROM_SCALE = 2;
const KEY_PAN_PX = 60;

export interface ScreenshotSource {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Screenshot viewer on a plain Canvas 2D context with zoom and pan.
 *
 * Coordinates: the viewport maps image pixels to CSS pixels of the canvas element (see
 * `core/domain/geometry.ts`). The backing store is `devicePixelRatio` times larger, which
 * is applied once in the draw transform – all interaction math stays in CSS pixels.
 * Phase 2 draws component regions as an additional layer on the same transform.
 */
export class ScreenshotViewer {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly zoomLabel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly abort = new AbortController();

  private viewport: Viewport = { scale: 1, x: 0, y: 0 };
  private stageSize: Size = { width: 0, height: 0 };
  private image: HTMLImageElement | null = null;
  private source: ScreenshotSource | null = null;
  /** The user has zoomed or panned – resizing then keeps the view instead of re-fitting. */
  private touched = false;
  private frame = 0;
  private drag: { pointerId: number; last: Point } | null = null;
  private loadToken = 0;

  constructor() {
    this.canvas = h('canvas', {
      class: 'viewer-canvas',
      attrs: { tabindex: 0, 'aria-label': t('viewer.help') },
    });
    const context = this.canvas.getContext('2d', { alpha: false });
    if (context === null) throw new Error('Canvas 2D is not available');
    this.context = context;

    this.zoomLabel = h('span', { class: 'viewer-zoom', attrs: { 'aria-live': 'polite' } }, '100 %');
    this.status = h('div', { class: 'viewer-status' });
    const button = (label: string, title: string, action: () => void) =>
      h('button', { attrs: { type: 'button', title, 'aria-label': title }, onClick: action }, label);

    this.element = h(
      'div',
      { class: 'viewer' },
      h(
        'div',
        { class: 'viewer-toolbar' },
        button('−', t('viewer.zoomOut'), () => {
          this.stepZoom('out');
        }),
        this.zoomLabel,
        button('+', t('viewer.zoomIn'), () => {
          this.stepZoom('in');
        }),
        button('1:1', t('viewer.actualSize'), () => {
          this.setScale(1);
        }),
        button('⤢', t('viewer.fit'), () => {
          this.fit('contain');
        }),
        button('↔', t('viewer.fitWidth'), () => {
          this.fit('width');
        }),
        h('small', { class: 'muted viewer-help' }, t('viewer.help')),
      ),
      h('div', { class: 'viewer-stage' }, this.canvas, this.status),
    );

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.canvas);
    this.bindInput();
  }

  /** Shows another screenshot. Re-fits the view; returns once the image is decoded. */
  async show(source: ScreenshotSource): Promise<void> {
    if (this.source?.url === source.url) return;
    this.source = source;
    const token = ++this.loadToken;
    const image = new Image();
    image.decoding = 'async';
    image.src = source.url;
    try {
      await image.decode();
    } catch {
      if (token !== this.loadToken) return;
      this.image = null;
      replaceChildren(this.status, t('viewer.loadError'));
      this.requestDraw();
      return;
    }
    if (token !== this.loadToken) return;
    replaceChildren(this.status);
    this.image = image;
    this.touched = false;
    this.fit(source.height > source.width * 2 ? 'width' : 'contain');
  }

  destroy(): void {
    this.abort.abort();
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
    this.image = null;
  }

  // ── View changes ────────────────────────────────────────────────────────────

  private imageSize(): Size {
    return { width: this.source?.width ?? 0, height: this.source?.height ?? 0 };
  }

  private center(): Point {
    return { x: this.stageSize.width / 2, y: this.stageSize.height / 2 };
  }

  private setViewport(viewport: Viewport, touched = true): void {
    this.viewport = viewport;
    this.touched = this.touched || touched;
    this.zoomLabel.textContent = `${String(Math.round(viewport.scale * 100))} %`;
    this.requestDraw();
  }

  private fit(mode: FitMode): void {
    this.setViewport(fitViewport(this.imageSize(), this.stageSize, mode), false);
    this.touched = false;
  }

  private stepZoom(direction: 'in' | 'out'): void {
    this.setViewport(zoomStep(this.viewport, this.center(), direction));
  }

  private setScale(scale: number): void {
    this.setViewport(zoomAt(this.viewport, this.center(), scale));
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const previous = this.stageSize;
    this.stageSize = { width: rect.width, height: rect.height };
    const ratio = window.devicePixelRatio;
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    if (!this.touched && this.image !== null) {
      const source = this.imageSize();
      this.fit(source.height > source.width * 2 ? 'width' : 'contain');
    } else {
      // Keep the image point in the centre stable while the stage changes size.
      const dx = (this.stageSize.width - previous.width) / 2;
      const dy = (this.stageSize.height - previous.height) / 2;
      this.setViewport(panBy(this.viewport, dx, dy), this.touched);
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private localPoint(event: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private bindInput(): void {
    const options = { signal: this.abort.signal };
    const canvas = this.canvas;

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_HEIGHT_PX : 1;
        if (event.ctrlKey || event.metaKey) {
          // Ctrl + wheel, and trackpad pinch gestures (reported with ctrlKey) zoom.
          const factor = wheelZoomFactor(event.deltaY * unit);
          this.setViewport(zoomAt(this.viewport, this.localPoint(event), this.viewport.scale * factor));
        } else {
          const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
          const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
          this.setViewport(panBy(this.viewport, -dx * unit, -dy * unit));
        }
      },
      { ...options, passive: false },
    );

    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 && event.button !== 1) return;
        canvas.focus();
        canvas.setPointerCapture(event.pointerId);
        this.drag = { pointerId: event.pointerId, last: this.localPoint(event) };
        canvas.classList.add('dragging');
      },
      options,
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (this.drag?.pointerId !== event.pointerId) return;
        const point = this.localPoint(event);
        this.setViewport(panBy(this.viewport, point.x - this.drag.last.x, point.y - this.drag.last.y));
        this.drag = { pointerId: event.pointerId, last: point };
      },
      options,
    );
    const endDrag = (event: PointerEvent): void => {
      if (this.drag?.pointerId !== event.pointerId) return;
      this.drag = null;
      canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', endDrag, options);
    canvas.addEventListener('pointercancel', endDrag, options);

    canvas.addEventListener(
      'keydown',
      (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const actions: Record<string, () => void> = {
          '+': () => {
            this.stepZoom('in');
          },
          '=': () => {
            this.stepZoom('in');
          },
          '-': () => {
            this.stepZoom('out');
          },
          '0': () => {
            this.fit('contain');
          },
          '1': () => {
            this.setScale(1);
          },
          w: () => {
            this.fit('width');
          },
          ArrowLeft: () => {
            this.setViewport(panBy(this.viewport, KEY_PAN_PX, 0));
          },
          ArrowRight: () => {
            this.setViewport(panBy(this.viewport, -KEY_PAN_PX, 0));
          },
          ArrowUp: () => {
            this.setViewport(panBy(this.viewport, 0, KEY_PAN_PX));
          },
          ArrowDown: () => {
            this.setViewport(panBy(this.viewport, 0, -KEY_PAN_PX));
          },
        };
        const action = actions[event.key];
        if (action === undefined) return;
        event.preventDefault();
        action();
      },
      options,
    );
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private requestDraw(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const context = this.context;
    const ratio = window.devicePixelRatio;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle =
      getComputedStyle(this.canvas).getPropertyValue('--viewer-background').trim() || '#808080';
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.image === null) return;

    const { scale, x, y } = this.viewport;
    context.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * x, ratio * y);
    context.imageSmoothingEnabled = scale < PIXELATED_FROM_SCALE;
    context.imageSmoothingQuality = 'high';
    context.drawImage(this.image, 0, 0);
  }
}
