/**
 * Rotation controller: the single writer of view frames.
 *
 * It owns the cadence (rotation interval + phase transitions), draws from the
 * selection engine, resolves placeholders, merges third-party phrase
 * providers, resolves the active preset/schedule and publishes immutable
 * frames to the store. The rich status view only animates what it reads.
 *
 * All side effects are clock-injected; every error path degrades to "line
 * hidden + diagnostic", never to a thrown exception inside a cordis event
 * handler.
 *
 * @module dsh-tui-status-rotator/runtime/controller
 */
import type { BankDoc, BankWarning, DiagnosticsSink, Lang, LiveContext, PackDoc, PhraseGroupsInput, PhraseInput, PhraseProviderSite, Phase, ResolvedConfig, SessionState } from '../types.js';
import type { SelectionSnapshot } from '../types.js';
import type { ViewFrameStore } from './store.js';
/** The phrase sources the controller builds banks from (assembled by index). */
export interface BankSources {
    readonly core?: BankDoc['phrases'];
    readonly packs: readonly PackDoc[];
    readonly enabledPacks?: readonly string[] | null;
}
/** One provider registered through the public extension service. */
export type PhraseProvider = (site: PhraseProviderSite) => readonly PhraseInput[] | PhraseGroupsInput;
/** Options for the controller. Every external read is injected. */
export interface RotationControllerOptions {
    config: ResolvedConfig;
    sources: BankSources;
    lang: Lang;
    store: ViewFrameStore;
    diagnostics: DiagnosticsSink;
    /** Latest live session facts; undefined = no active session. */
    state?: () => SessionState | undefined;
    /** Third-party phrase providers (extension service). */
    providers?: () => readonly PhraseProvider[];
    /** Third-party placeholder values (extension service), read per frame. */
    placeholders?: (live: LiveContext) => Readonly<Record<string, string>>;
    clock?: () => number;
    rng?: () => number;
    /** Controller tick in ms; 500 keeps phase transitions snappy without churn. */
    tickMs?: number;
}
/** Snapshot exposed to the /status-rotator command. */
export interface ControllerStatus {
    readonly enabled: boolean;
    readonly configuredEnabled: boolean;
    readonly labelSource: 'phrases' | 'host';
    readonly lang: Lang;
    readonly phase: Phase | undefined;
    readonly line: string | undefined;
    readonly visible: boolean;
    readonly presetId: string | null;
    readonly packs: readonly string[];
    readonly bankWarnings: readonly BankWarning[];
    readonly ticking: boolean;
}
/**
 * Drives the rotating status line.
 */
export declare class RotationController {
    private config;
    private sources;
    private lang;
    private readonly store;
    private readonly diagnostics;
    private readonly stateProvider;
    private readonly providerSource;
    private readonly placeholderSource;
    private readonly clock;
    private readonly engine;
    private readonly resolver;
    private readonly tickMs;
    private timer;
    private baseBank;
    private presetBank;
    private presetCacheKey;
    private current;
    private presetId;
    private enabledOverride;
    private readonly bankWarnings;
    constructor(options: RotationControllerOptions);
    /** Start the rotation timer (idempotent) and render the first frame. */
    start(): void;
    /** Stop the rotation timer and hide the line. */
    stop(): void;
    /** Update config (settings reload / row config change). */
    setConfig(config: ResolvedConfig): void;
    /** Update bank sources (external bank reload / config pack selection). */
    setSources(sources: BankSources): void;
    /** Switch the phrase language. */
    setLanguage(lang: Lang): void;
    /** Runtime on/off override from the /status-rotator command. */
    setEnabled(enabled: boolean): void;
    /** Whether the line is currently enabled (override wins over config). */
    enabled(): boolean;
    /** Force the next phrase (command: next). */
    next(): void;
    /** One controller step; exposed for tests and forced refreshes. */
    tick(): void;
    /** Diagnostics/status snapshot for the command output. */
    status(): ControllerStatus;
    /** Bank warnings introduced after construction (external reload). */
    bankWarningsList(): readonly BankWarning[];
    /** Selection-engine memory for the extension API status output. */
    engineSnapshot(): SelectionSnapshot;
    /** One internal step. */
    private step;
    /** Resolve the active preset for the schedule and swap the bank if needed. */
    private resolvePreset;
    /** The bank in effect: base bank or the scheduled/pinned preset snapshot. */
    private effectiveBank;
    /** Draw one phrase and publish it. */
    private draw;
    /** Resolve placeholders and publish a frame. */
    private publish;
    /** Merge third-party provider phrases into the current phase group. */
    private phaseEntries;
    /** Build the live facts for placeholder resolution and conditions. */
    private buildLive;
    /** Rebuild the base bank and remember normalization warnings. */
    private rebuildBaseBank;
    /** Surface each bank normalization warning exactly once. */
    private reportBankWarnings;
    /** Hide the line and forget the current phrase. */
    private hide;
}
