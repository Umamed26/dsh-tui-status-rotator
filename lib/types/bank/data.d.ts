/**
 * Built-in phrase bank: the 14 packs shipped with dsh-status-rotator, ported
 * verbatim, plus the default enabled-pack selection.
 *
 * Source: dsh-status-rotator config.example.json (web plugin). The original
 * core `phrases` table is empty — every default phrase lives in a pack — so
 * BUILTIN_CORE_PHRASES is `{}` and the 10 default packs supply 945 entries
 * (zh 505 / en 440). Total corpus: 1362 entries (zh 746 / en 616).
 *
 * The data is deep-frozen: nothing may mutate the shipped copy at runtime.
 *
 * @module dsh-tui-status-rotator/bank/data
 */
import type { BankDoc, PackDoc } from '../types.js';
/**
 * Core `phrases` table of the shipped bank. The web original ships an empty
 * table (all phrases live in packs); kept as `{}` so the canonical JSON of
 * the port matches config.example.json byte for byte.
 */
export declare const BUILTIN_CORE_PHRASES: NonNullable<BankDoc['phrases']>;
/** Default enabled packs, in config.example.json order (community/ads/star packs off). */
export declare const DEFAULT_ENABLED_PACKS: readonly string[];
/** The 14 built-in packs, in config.example.json order. */
export declare const BUILTIN_PACKS: readonly PackDoc[];
/** The shipped bank document (core + packs + default selection). */
export declare const BUILTIN_BANK_DOC: BankDoc;
/** SHA-256 of the canonical shipped-bank JSON (see test/bank/data.test.ts). */
export declare const BUILTIN_BANK_SHA256 = "d6bbe22db130228eae4683b7bda6db10ebc3eb97369e6f6879eee6d97989ae25";
