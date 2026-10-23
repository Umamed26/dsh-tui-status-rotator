import type { ResolvedConfig, ScheduleRuleInput, PresetInput, BankWarning } from './types.js';
/** Raw config as declared in the profile patch and projected by the settings service. */
export type Config = {
    enabled?: boolean;
    language?: string;
    intervalMs?: number;
    typeSpeedMs?: number;
    thinkingMs?: number;
    longAfterMs?: number;
    weightedRandom?: boolean;
    antiRepeatRecentLimit?: number;
    labelSource?: string;
    gradientEnabled?: boolean;
    gradientMode?: string;
    gradientDirection?: string;
    gradientColors?: string;
    gradientDayColors?: string;
    gradientSpeedSec?: number;
    /** Advanced: undefined = built-in default pack set; [] = core phrases only. */
    enabledPacks?: string[] | null;
    /** Advanced: named phrase presets. */
    presets?: PresetInput[];
    /** Advanced: weekly preset schedule. */
    schedule?: ScheduleRuleInput[];
    /** Advanced: preset pinned as the non-scheduled choice. */
    activePreset?: string | null;
    /** Advanced: external bank file path override (undefined = default path). */
    bankPath?: string | null;
};
/** Default night palette, ported from dsh-status-rotator's config.example.json. */
export declare const DEFAULT_GRADIENT_COLORS: readonly string[];
/** Default day palette, ported from dsh-status-rotator's config.example.json. */
export declare const DEFAULT_GRADIENT_DAY_COLORS: readonly string[];
/**
 * Adaptive palette used by gradientMode 'theme': host theme color keys the
 * status view's ThemedText resolves per active theme, so the rainbow follows
 * light/dark themes without the plugin knowing the theme name (dsh-TUI does
 * not expose the active theme to rich status views).
 */
export declare const THEME_GRADIENT_PALETTE: readonly string[];
/** The plugin's Config schema (declared in package.json's plugin contract). */
export declare const Config: Schemastery<Config>;
/** Parse a comma-separated color list; invalid entries are dropped with a warning. */
export declare function parseColorList(warnings: BankWarning[], code: string, value: unknown, fallback: readonly string[], themeKeys: ReadonlySet<string>): readonly string[];
/** Whether a color is a safe hex/rgb/ansi value or a known host theme key. */
export declare function isSafeColor(value: string, themeKeys?: ReadonlySet<string>): boolean;
/**
 * Detect the UI language for 'auto': DSH_TUI_LANG -> ~/.dsh-tui/lang.json ->
 * OS locale -> zh. All injected reads are total: a missing/corrupt source
 * never breaks resolution.
 */
export declare function detectLanguage(env: NodeJS.ProcessEnv, readLangFile: () => unknown, systemLocale: string): 'zh' | 'en';
/** Fully defaulted defaults (exported for tests and docs). */
export declare const DEFAULT_RESOLVED_CONFIG: ResolvedConfig;
/**
 * Resolve raw config (from the cordis patch row / settings getters) into a
 * fully-defaulted ResolvedConfig. Never throws: invalid input falls back with
 * a warning so the UI can state WHY a value was ignored.
 */
export declare function resolveConfig(raw: Config | undefined): {
    config: ResolvedConfig;
    warnings: readonly BankWarning[];
};
