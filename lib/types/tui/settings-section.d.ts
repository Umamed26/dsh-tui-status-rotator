/**
 * Plugin settings section (seam 6: `tuiSettingsSections`).
 *
 * dsh-TUI's settings screen is declarative: the plugin describes *which* fields
 * are editable and the host owns rendering, staged editing, save/discard and
 * revision-fenced `settings.mutate` writes. Storage and validation stay with
 * the dsh settings service under this profile row's settings namespace.
 *
 * The namespace is the profile row id (the Config owner's Loader id), resolved
 * by the host probe; the fallback matches `cordis.patch.yml`. Only the 15
 * Schemastery-volatile keys from `src/config.ts` are listed - the advanced
 * array keys (packs/presets/schedule/activePreset/bankPath) cannot be edited by
 * the host's field kinds and stay profile-patch / bank-file territory.
 *
 * @module dsh-tui-status-rotator/tui/settings-section
 */
import type { DiagnosticsSink, TuiSettingsSection } from '../types.js';
import type { HostPorts, StructuralContext } from './host.js';
/** English section title (also the fallback title). */
export declare const SETTINGS_SECTION_TITLE = "Status rotator";
/** Options accepted by {@link registerSettingsSection}. */
export interface SettingsSectionOptions {
    /** Settings namespace to edit (the profile row id / host entry id). */
    readonly ns: string;
    readonly diagnostics: DiagnosticsSink;
}
/** The 15 editable config keys (must mirror src/config.ts EDITABLE_KEYS). */
export declare const EDITABLE_SETTINGS_KEYS: readonly ["enabled", "language", "intervalMs", "typeSpeedMs", "thinkingMs", "longAfterMs", "weightedRandom", "antiRepeatRecentLimit", "labelSource", "gradientEnabled", "gradientMode", "gradientDirection", "gradientColors", "gradientDayColors", "gradientSpeedSec"];
/** Build the declarative section for a settings namespace (pure, exported for tests). */
export declare function buildSettingsSection(ns: string): TuiSettingsSection;
/**
 * Register the settings section (seam 6). Returns the host's unregister
 * disposer, or `undefined` when the seam is absent or refuses the section
 * (duplicate namespace, invalid ns). Never throws; every degradation is a
 * diagnostic.
 */
export declare function registerSettingsSection(_ctx: StructuralContext, ports: HostPorts, options: SettingsSectionOptions): (() => void) | undefined;
