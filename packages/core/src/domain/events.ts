import type { SessionStatus } from './session.js';

/** Domain events, published after the surrounding transaction has committed. */
export type DomainEvent =
  | { readonly type: 'ProjectChanged'; readonly projectId: string }
  | { readonly type: 'UiViewChanged'; readonly projectId: string; readonly uiViewId: string }
  | {
      readonly type: 'ScreenshotSubmitted';
      readonly projectId: string;
      readonly uiViewId: string;
      readonly screenshotId: string;
      readonly sessionId: string | null;
    }
  | { readonly type: 'SessionChanged'; readonly projectId: string; readonly sessionId: string }
  | {
      readonly type: 'SessionStatusChanged';
      readonly projectId: string;
      readonly sessionId: string;
      readonly from: SessionStatus | null;
      readonly to: SessionStatus;
    };
