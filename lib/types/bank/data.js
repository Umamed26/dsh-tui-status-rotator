import { PACK_REVERSE_PROXY } from './packs/reverse-proxy.js';
import { PACK_DEEPSEEK } from './packs/deepseek.js';
import { PACK_WESTERN_AI } from './packs/western-ai.js';
import { PACK_CHINA_AI } from './packs/china-ai.js';
import { PACK_CODING } from './packs/coding.js';
import { PACK_SYSADMIN } from './packs/sysadmin.js';
import { PACK_MATH_PHYSICS } from './packs/math-physics.js';
import { PACK_SLACKING } from './packs/slacking.js';
import { PACK_INTERNET_MEMES } from './packs/internet-memes.js';
import { PACK_DAILY } from './packs/daily.js';
import { PACK_COMMUNITY } from './packs/community.js';
import { PACK_ADS } from './packs/ads.js';
import { PACK_STAR_ASK } from './packs/star-ask.js';
import { PACK_STAR_ROUTE } from './packs/star-route.js';
/** Recursively freeze a JSON-shaped value. */
function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
        }
    }
    return value;
}
/**
 * Core `phrases` table of the shipped bank. The web original ships an empty
 * table (all phrases live in packs); kept as `{}` so the canonical JSON of
 * the port matches config.example.json byte for byte.
 */
export const BUILTIN_CORE_PHRASES = deepFreeze({});
/** Default enabled packs, in config.example.json order (community/ads/star packs off). */
export const DEFAULT_ENABLED_PACKS = deepFreeze([
    'reverse-proxy',
    'deepseek',
    'western-ai',
    'china-ai',
    'coding',
    'sysadmin',
    'math-physics',
    'slacking',
    'internet-memes',
    'daily',
]);
/** The 14 built-in packs, in config.example.json order. */
export const BUILTIN_PACKS = deepFreeze([
    PACK_REVERSE_PROXY,
    PACK_DEEPSEEK,
    PACK_WESTERN_AI,
    PACK_CHINA_AI,
    PACK_CODING,
    PACK_SYSADMIN,
    PACK_MATH_PHYSICS,
    PACK_SLACKING,
    PACK_INTERNET_MEMES,
    PACK_DAILY,
    PACK_COMMUNITY,
    PACK_ADS,
    PACK_STAR_ASK,
    PACK_STAR_ROUTE,
]);
/** The shipped bank document (core + packs + default selection). */
export const BUILTIN_BANK_DOC = deepFreeze({
    phrases: BUILTIN_CORE_PHRASES,
    packs: BUILTIN_PACKS,
    enabledPacks: DEFAULT_ENABLED_PACKS,
});
/** SHA-256 of the canonical shipped-bank JSON (see test/bank/data.test.ts). */
export const BUILTIN_BANK_SHA256 = 'd6bbe22db130228eae4683b7bda6db10ebc3eb97369e6f6879eee6d97989ae25';
