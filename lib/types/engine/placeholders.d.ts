/**
 * Template placeholders: the TUI port of the web plugin's {elapsed} {phase}
 * ... interpolation.
 *
 * Built-in placeholders always win. `LiveContext.vars` (values contributed by
 * other plugins through the public extension service) fills every name the
 * resolver does not own, so third parties can add `{myState}` without being
 * able to shadow a built-in. Unknown placeholders are left verbatim and
 * reported, so the command/diagnostics view can name the misspelling instead
 * of rendering a silently empty prefix.
 *
 * Registration contract (service concern, runtime/service.ts): registering a
 * placeholder whose name is in {@link BUILTIN_PLACEHOLDER_NAMES} MUST throw at
 * registration time. That reserved set is exported here so the service can
 * import it instead of duplicating the list; a collision is a programming
 * error, not a runtime fallback.
 *
 * @module dsh-tui-status-rotator/engine/placeholders
 */
import type { Lang, PlaceholderResolver } from '../types.js';
/** Names owned by the built-in resolver; third parties must not register them. */
export declare const BUILTIN_PLACEHOLDER_NAMES: ReadonlySet<string>;
/**
 * Valid custom placeholder name shape (same grammar the extension service
 * enforces: an identifier with optional dashes, 1..32 chars).
 */
export declare const PLACEHOLDER_NAME_PATTERN: RegExp;
/**
 * Localized duration text, matching the host clock style:
 * zh `1分02秒` / en `1m 02s`; hours keep the same shape
 * (zh `1小时0分00秒`, en `1h 0m 0s`). Negative/NaN input counts as 0.
 *
 * @param ms elapsed milliseconds
 * @param lang UI language
 */
export declare function formatElapsed(ms: number, lang: Lang): string;
/** Whether `name` belongs to the built-in resolver. */
export declare function isBuiltinPlaceholder(name: string): boolean;
/**
 * Create the placeholder resolver. Built-ins win; `LiveContext.vars` fills
 * names the resolver does not own; anything left is kept verbatim and
 * reported through `unknown` (each name at most once, first-seen order).
 */
export declare function createPlaceholderResolver(): PlaceholderResolver;
