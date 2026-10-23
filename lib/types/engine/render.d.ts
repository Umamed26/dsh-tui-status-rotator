/**
 * Pure render helpers for the rich status view: grapheme segmentation,
 * typewriter reveal counts and the per-cell gradient sweep.
 *
 * The web plugin animated one CSS background gradient across the whole text;
 * terminal cells cannot interpolate, so the TUI port paints **one palette color
 * per grapheme** and animates by shifting the palette index over time. The
 * model (also documented in docs/engine.md):
 *
 * - palette entries are cycled per grapheme: `color(i, t) = palette[(i + dir * step) mod L]`
 *   where `L` is the palette length, `i` the grapheme index, and
 *   `step = floor((now - startedAt) / speedMs * L)`;
 * - one full palette cycle therefore takes exactly `speedMs` (after that,
 *   `dir * L` is a multiple of `L` and the frame is identical), so a
 *   `speedMs` of 4000 with 7 colors advances one step every ~571ms;
 * - `rtl` (default) moves the pattern right-to-left, `ltr` left-to-right;
 *   at t=0 both start from the same spatial sequence, only the motion differs;
 * - there is no interpolation: adjacent cells are adjacent palette entries,
 *   which is the crisp "rainbow stripe" look terminals can actually draw.
 *
 * @module dsh-tui-status-rotator/engine/render
 */
import type { GradientSpec, ResolvedConfig } from '../types.js';
/**
 * Split text into user-perceived characters (graphemes) so the typewriter and
 * gradient never cut an emoji/ZWJ sequence or a combining mark in half.
 * Falls back to code points when Intl.Segmenter is unavailable.
 */
export declare function textGraphemes(text: string): readonly string[];
/**
 * How many graphemes of `text` are visible at `now`.
 *
 * The first grapheme appears immediately at `startedAt` (no blank frame), then
 * one more per `typeSpeedMs`. `typeSpeedMs <= 0` (and non-finite values)
 * reveal everything at once; times before the start clamp to the first
 * grapheme; the result is capped at the grapheme count.
 */
export declare function revealCount(text: string, startedAt: number, typeSpeedMs: number, now: number): number;
/**
 * One color per grapheme for the current frame (see the module docs for the
 * exact model). Returns exactly `count` colors; `[]` when the palette is empty
 * or `count` is not positive. A pinned `now`/`startedAt` pair produces an
 * identical array, so the view can stay a pure function of its frame + clock.
 */
export declare function gradientColors(spec: GradientSpec, count: number, now: number, startedAt: number): readonly string[];
/**
 * Turn the resolved config into the view's gradient spec.
 *
 * - `gradientEnabled: false` -> undefined (the view renders plain text);
 * - `theme` -> {@link THEME_GRADIENT_PALETTE} (host theme color keys the view's
 *   themed text primitive resolves per light/dark theme);
 * - `day` -> `config.gradientDayColors`; `night` -> `config.gradientColors`;
 * - `speedMs` = `gradientSpeedSec * 1000`, clamped to the config envelope
 *   (1..60s) so a hand-built config can never spin faster than the settings
 *   allow. An empty palette disables the gradient instead of painting one
 *   invisible color.
 */
export declare function resolveGradientSpec(config: ResolvedConfig): GradientSpec | undefined;
