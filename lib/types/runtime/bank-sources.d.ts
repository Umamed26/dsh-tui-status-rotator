/**
 * Assemble the bank sources the rotation controller consumes from the
 * built-in packs, the optional external bank override and the resolved config.
 *
 * Layering (highest priority last):
 *   built-in packs -> external bank packs by id -> config enabled-pack choice.
 * An external pack with the same id replaces the built-in pack wholesale (the
 * documented, predictable rule); a new id appends. External core phrases are
 * the only core layer because the built-in core is empty.
 *
 * @module dsh-tui-status-rotator/runtime/bank-sources
 */
import type { BankDoc, PackDoc, ResolvedConfig } from '../types.js';
import type { BankSources } from './controller.js';
/** Inputs for one assembly pass. */
export interface AssembleBankSourcesInput {
    readonly builtinPacks: readonly PackDoc[];
    readonly defaultEnabledPacks: readonly string[];
    readonly external: BankDoc | null;
    readonly config: ResolvedConfig;
}
/**
 * Build the controller's BankSources. Never throws: malformed external packs
 * that cannot be keyed by id are ignored (the loader already validated shape).
 */
export declare function assembleBankSources(input: AssembleBankSourcesInput): BankSources;
