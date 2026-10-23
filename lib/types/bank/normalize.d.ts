/**
 * Phrase-bank normalization and merge.
 *
 * The web original treats its bank document as trusted JSON (the node half
 * rejects malformed documents and the settings page writes valid ones). The
 * TUI port additionally reads an external, hand-edited hot-reload file, so
 * every boundary here is defensive: invalid input never throws, invalid
 * entries are dropped and reported as {@link BankWarning}s instead of silently
 * changing a phrase's meaning.
 *
 * Semantics carried over from dsh-status-rotator (README_ZH "词库包"):
 *   - a bank is a core \`phrases\` table plus a list of named packs;
 *   - packs merge in array order, filtered by \`enabledPacks\`;
 *   - per language + phase, entries are de-duplicated by text and the first
 *     occurrence keeps its weight;
 *   - \`enabledPacks\` undefined/null = every pack, \`[]\` = core only, unknown
 *     ids are ignored (the original silently; the TUI reports a warning so a
 *     typo is visible instead of a silently smaller bank).
 *
 * Deliberate hardening over the original (documented in docs/bank.md):
 *   - phrase text must be a non-blank string without control characters and
 *     at most {@link MAX_PHRASE_CODE_POINTS} code points (the original only
 *     required a non-empty string; 200 is the original submission limit);
 *   - an invalid \`when\` drops the entry (the original client silently made it
 *     unconditional, which is the one failure mode this repo avoids);
 *   - an invalid weight still degrades to 1 (README: "非法值按 1 处理") and an
 *     invalid rarity is dropped from the entry, both with a warning.
 *
 * @module dsh-tui-status-rotator/bank/normalize
 */
import type { BankDoc, BankWarning, Lang, MergedBank, PackDoc, Phase, PhaseGroups, PhraseEntry, PhraseInput } from '../types.js';
import { BUILTIN_PACKS, DEFAULT_ENABLED_PACKS } from './data.js';
export { BUILTIN_PACKS, DEFAULT_ENABLED_PACKS };
/** Longest accepted phrase text, in Unicode code points. */
export declare const MAX_PHRASE_CODE_POINTS = 200;
/** Weight ceiling (original README: weight cap 1000). */
export declare const MAX_PHRASE_WEIGHT = 1000;
/** Longest accepted \`when.tool\` name. */
export declare const MAX_TOOL_NAME_LENGTH = 64;
/** Longest accepted pack id. */
export declare const MAX_PACK_ID_LENGTH = 64;
/**
 * Normalize one phrase entry from untrusted input (single-argument form used
 * by provider merging and by tests). Invalid entries return undefined; no
 * diagnostics are emitted from this signature.
 */
export declare function normalizePhraseInput(value: unknown): PhraseEntry | undefined;
/**
 * Normalize one language's phrase groups.
 *
 * Accepted shapes (matching the original \`normalizeGroups\`):
 *   - \`{ thinking: [...], running: [...], long: [...] }\` (missing groups = empty);
 *   - a legacy flat phrase array, treated as the thinking group.
 *
 * Invalid entries are dropped with a warning and the remaining entries are
 * returned; the result always has all three phase arrays.
 *
 * @param input - untrusted phrase-group input.
 * @param source - diagnostic path prefix, e.g. \`packs[2].phrases.zh\`.
 */
export declare function normalizePhraseGroups(input: unknown, source: string): {
    groups: PhaseGroups;
    warnings: readonly BankWarning[];
};
/**
 * Normalize one pack object.
 *
 * @param input - untrusted pack input.
 * @param source - diagnostic path prefix, e.g. \`packs[0]\`.
 * @returns the normalized pack, or undefined when unusable.
 */
export declare function normalizePackInput(input: unknown, source: string): {
    pack?: PackDoc;
    warnings: readonly BankWarning[];
};
/**
 * Merge additional phrase inputs into one phase list.
 *
 * Entries are normalized first (invalid ones are dropped) and de-duplicated by
 * text against the base list and each other; the first occurrence keeps its
 * weight, so callers control priority through argument order. The controller
 * passes third-party provider phrases with this helper, which is why \`source\`
 * only exists for diagnostics (the merged list has no warning channel).
 *
 * @param base - already normalized entries (highest priority).
 * @param extra - untrusted phrase inputs appended after the base.
 * @param source - diagnostic path prefix used when describing dropped extras.
 */
export declare function mergePhaseEntries(base: readonly PhraseEntry[], extra: readonly PhraseInput[], source?: string): readonly PhraseEntry[];
/** Input accepted by {@link mergeBank}. */
export interface MergeBankInput {
    /** Core phrase table (may be the normalized external-bank phrases). */
    readonly core?: BankDoc['phrases'];
    /** Packs in merge order; \`enabledPacks\` selects the subset. */
    readonly packs?: readonly PackDoc[];
    /** undefined/null = all packs, \`[]\` = core only. */
    readonly enabledPacks?: readonly string[] | null;
    /** Runtime-only phrase sources merged after every pack (provider content). */
    readonly extraCore?: Readonly<Record<Lang, Partial<Record<Phase, readonly PhraseInput[]>>>>;
}
/**
 * Build one merged, normalized bank from a core table, packs and pack
 * selection.
 *
 * Merge order (first occurrence wins on duplicate text):
 *   core -> enabled packs (in array order) -> extraCore.
 *
 * @param input - core phrases, packs, enabled-pack selection, extra sources.
 * @returns the merged bank plus the packs that contributed at least one entry.
 */
export declare function mergeBank(input: MergeBankInput): MergedBank;
/** Result of normalizing one untrusted bank document. */
export interface NormalizedBankDoc {
    /** The accepted document (only \`phrases\` / \`packs\` / \`enabledPacks\` survive). */
    readonly doc: BankDoc;
    /** False when the input was not a usable bank document at all. */
    readonly valid: boolean;
    readonly warnings: readonly BankWarning[];
}
/**
 * Validate and normalize an untrusted bank document.
 *
 * Only \`packs\` / \`phrases\` / \`enabledPacks\` are accepted; every other key is
 * ignored with a warning (the web original's external bank also ignores
 * \`config\`, and this port additionally accepts \`enabledPacks\`).
 *
 * @param input - untrusted JSON value.
 * @param source - diagnostic path prefix (the external loader passes its file path).
 */
export declare function normalizeBankDoc(input: unknown, source?: string): NormalizedBankDoc;
