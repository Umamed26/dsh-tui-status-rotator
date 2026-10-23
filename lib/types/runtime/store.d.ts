/**
 * Subscribable frame store shared by the runtime controller and the rich
 * status view component. The controller is the single writer; the component
 * only reads snapshots and subscribes (the shape tuiStatus.registerView
 * components are expected to consume, since the host injects no data props).
 *
 * @module dsh-tui-status-rotator/runtime/store
 */
import type { ViewFrame, ViewStoreLike } from '../types.js';
/** The invisible frame: nothing rendered, revision still advances on change. */
export declare const HIDDEN_FRAME: ViewFrame;
/** A frame without its revision (the store stamps it). */
export type FrameInput = Omit<ViewFrame, 'revision'>;
/** Minimal external store for view frames. */
export declare class ViewFrameStore implements ViewStoreLike {
    private frame;
    private readonly listeners;
    get snapshot(): ViewFrame;
    subscribe: (listener: () => void) => (() => void);
    /** Publish a new frame. No-ops (and does not notify) on a deep-equal frame. */
    publish(input: FrameInput): void;
    /** Hide the line (idempotent). */
    hide(): void;
    private emit;
}
