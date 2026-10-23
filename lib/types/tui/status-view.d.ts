/**
 * Rich status view (seam 11: `tuiStatus.registerView`).
 *
 * The host mounts this component directly above the prompt, gives it its own
 * React instance plus a pointer-only UI kit and clips it to `maxRows` rows.
 * Everything else - the phrase, phase, typewriter clock and gradient spec - is
 * read from the injected {@link ViewStoreLike}; the component subscribes with
 * `useSyncExternalStore` (the store keeps a referentially stable snapshot).
 *
 * React contract (hard):
 * - hooks come from the injected `props.React` (React 19 single-React rule):
 *   importing our own React would make hook dispatch fail on first render;
 * - elements are built with `props.React.createElement` - no JSX and no React
 *   runtime import, so the package stays framework-agnostic at runtime.
 *
 * Animation policy: a timer only runs while something can actually change -
 * the typewriter is still revealing graphemes or a gradient has to flow. Once
 * the phrase is fully revealed and gradients are off, the timer stops (no
 * 60fps spin in the background). Hiding the line (`frame.visible === false`)
 * renders `null`, so the host reserves no row.
 *
 * @module dsh-tui-status-rotator/tui/status-view
 */
import type { ComponentType } from 'react';
import type { DiagnosticsSink, TuiStatusViewProps, ViewStoreLike } from '../types.js';
import type { HostPorts, StructuralContext } from './host.js';
/** tuiStatus key the rich view and the plain-text fallback share. */
export declare const STATUS_VIEW_KEY = "status-rotator";
/** The view is a single line: the host clips at `maxRows` anyway. */
export declare const STATUS_VIEW_MAX_ROWS: 1;
/**
 * Create the React component registered with `tuiStatus.registerView`.
 *
 * The store is injected by closure (the host passes no data props), which is
 * exactly how the dsh-TUI docs describe rich status views: the component owns
 * its live data through an external store.
 */
export declare function createStatusViewComponent(store: ViewStoreLike): ComponentType<TuiStatusViewProps>;
/**
 * Register the rich status view (seam 11).
 *
 * Returns the host's disposer, or `undefined` when the seam is unavailable or
 * refuses the registration - the caller then switches to the plain-text
 * fallback. Refusals are always reported (the host logs its own reason; this
 * adds the plugin-facing diagnostic), never thrown.
 */
export declare function registerRichStatus(ctx: StructuralContext, ports: HostPorts, store: ViewStoreLike, diagnostics: DiagnosticsSink): (() => void) | undefined;
