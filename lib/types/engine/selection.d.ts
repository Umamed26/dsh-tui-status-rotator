/**
 * Phrase selection engine: the TUI port of the web plugin's draw pipeline.
 *
 * One draw is: rarity gate -> conditional/plain partition (conditional
 * priority) -> shuffle-bag draw inside the active language+phase bag, with
 * cross-bag anti-repeat memory. All randomness is injected, there is no clock
 * and no I/O, so every draw is reproducible in tests.
 *
 * Semantics are pinned to the original plugin (README_ZH sections
 * "加权随机 / 反重复(洗牌袋) / 条件句(when)与稀有句" and
 * scripts/verify-phrase-selection.cjs):
 *
 * - weights are clamped to 1..1000; anything invalid counts as 1, and
 *   `weighted: false` turns the draw fully uniform;
 * - a shuffle bag per `lang|phase` never repeats a phrase inside one round;
 *   when a bag is refilled at a seam the last `antiRepeatRecentLimit` (0..50)
 *   texts are trimmed so the seam does not repeat either. A changed candidate
 *   pool (phase/language/condition change) restarts the bag, so stale phrases
 *   never leak through;
 * - rarity is rolled first, with exactly one `rng()` call per entry that
 *   declares a rarity in (0, 1). If the rolls empty the pool the full pool is
 *   used again, so an unlucky roll can never blank the status line;
 * - `when` conditions are AND-ed. If any conditional entry matches, the draw
 *   pool is exactly the matching conditionals (a single `tool: "bash"` phrase
 *   must not be drowned by a thousand unconditional ones); otherwise the plain
 *   entries are used; if every entry is conditional and none matches, the full
 *   eligible pool is used so the line still rotates;
 * - conditions fail closed: no running tool means every `tool` rule is false,
 *   and `hour` is evaluated against `LiveContext.hour` (the engine never reads
 *   the clock on its own).
 *
 * @module dsh-tui-status-rotator/engine/selection
 */
import type { LiveContext, PhraseEntry, SelectionEngine, WhenCondition } from '../types.js';
/** Weight cap from the original plugin (invalid or below 1 counts as 1). */
export declare const MAX_PHRASE_WEIGHT = 1000;
/** Anti-repeat memory cap from the original plugin (0..50). */
export declare const MAX_RECENT_LIMIT = 50;
/** Memory length used when the caller does not supply a usable value. */
export declare const DEFAULT_RECENT_LIMIT = 3;
/** Clamp one phrase weight into the original 1..1000 range. */
export declare function normalizePhraseWeight(weight: unknown): number;
/** Normalize rarity: only a finite number in (0, 1] is valid; anything else is "no gate". */
export declare function normalizeRarity(rarity: unknown): number | undefined;
/** Whether `hour` is inside a [from, to) local-hour window; from === to means all day. */
export declare function hourInWindow(window: readonly [number, number], hour: number): boolean;
/**
 * Normalize a `when` rule (untrusted JSON may be partially invalid).
 *
 * Unknown keys and invalid values are dropped; a rule with no usable condition
 * returns undefined, which makes the phrase unconditional rather than "never
 * matches" (mirrors the original normalizeWhen).
 */
export declare function normalizeWhen(when: WhenCondition | undefined | null): WhenCondition | undefined;
/**
 * Whether a `when` rule matches the live facts (pure helper, exported for tests
 * and for callers that want to pre-filter pools themselves).
 */
export declare function matchWhen(when: WhenCondition | undefined | null, live: LiveContext): boolean;
/**
 * Select the candidate pool for one draw: rarity gate first, then conditional
 * priority (matching conditionals > plain entries > full eligible pool).
 * Exported as a pure building block; the engine calls it with its injected rng.
 */
export declare function selectCandidatePool(entries: readonly PhraseEntry[], live: LiveContext, rng: () => number): readonly PhraseEntry[];
/** Options for {@link createSelectionEngine}. */
export interface SelectionEngineOptions {
    /** Random source in [0, 1); defaults to Math.random. Injected for tests. */
    readonly rng?: () => number;
}
/**
 * Create the stateful selector: one shuffle bag and one recency list per
 * language+phase key, both serializable through snapshot()/restore().
 */
export declare function createSelectionEngine(options?: SelectionEngineOptions): SelectionEngine;
