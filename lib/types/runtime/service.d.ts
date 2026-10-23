/**
 * The cordis service this plugin provides for other plugins (the TUI port of
 * the web plugin's ctx.statusRotator): register extra packs, placeholders and
 * dynamic phrase providers without editing this package.
 *
 * Registration is explicit-failure: duplicate ids, collisions with built-in
 * placeholders and non-function providers throw at registration time instead
 * of producing a silent no-op. Content registered here is never persisted into
 * config files, matching the original contract.
 *
 * @module dsh-tui-status-rotator/runtime/service
 */
import type { DiagnosticsSink, Lang, LiveContext, PackDoc, Phase, PhraseGroupsInput, PhraseInput, PhraseProviderSite, SelectionSnapshot, StatusRotatorApi } from '../types.js';
/**
 * Placeholder names owned by the built-in resolver; third parties cannot
 * override them. The engine's built-in list is the single source of truth so
 * the registration guard cannot drift from what the resolver actually knows.
 */
export declare const RESERVED_PLACEHOLDERS: ReadonlySet<string>;
/** One dynamic phrase provider registered by another plugin. */
export type RegisteredProvider = (site: PhraseProviderSite) => readonly PhraseInput[] | PhraseGroupsInput;
/** Mutable registry behind the public service (owned by index, read by controller). */
export interface ExtensionState {
    readonly packs: PackDoc[];
    readonly providers: RegisteredProvider[];
    readonly placeholders: Map<string, (live: LiveContext) => string>;
}
/** Create an empty extension registry. */
export declare function createExtensionState(): ExtensionState;
/**
 * Provider view over registered packs, so packs registered at runtime join the
 * same selection pipeline (dedupe/conditions/weights) as the built-in bank.
 */
export declare function packPhraseProvider(state: ExtensionState): RegisteredProvider;
/** Resolve all third-party placeholder values for one frame. */
export declare function resolveExtensionPlaceholders(state: ExtensionState, diagnostics: DiagnosticsSink, live: LiveContext): Readonly<Record<string, string>>;
/** Host seam availability reported by the extension API status(). */
export interface HostFlags {
    readonly richStatusView: boolean;
    readonly plainStatus: boolean;
    readonly settingsSection: boolean;
    readonly commands: boolean;
}
/** Dependencies for the public service. */
export interface StatusRotatorServiceOptions {
    readonly state: ExtensionState;
    readonly diagnostics: DiagnosticsSink;
    readonly hostFlags: () => HostFlags;
    readonly engineSnapshot: () => SelectionSnapshot;
    readonly includedPacks: () => readonly string[];
}
/** Build the public extension API. */
export declare function createStatusRotatorService(options: StatusRotatorServiceOptions): StatusRotatorApi;
/** Empty selection snapshot used before the controller exists (defensive). */
export declare const EMPTY_SELECTION_SNAPSHOT: SelectionSnapshot;
/** Phase helper retained for the service status output. */
export declare function describePhase(phase: Phase | undefined, lang: Lang): string;
