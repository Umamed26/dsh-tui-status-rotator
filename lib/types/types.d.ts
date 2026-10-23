/**
 * Shared contracts for dsh-tui-status-rotator.
 *
 * Every module in this package codes against these types so the engine, the
 * phrase bank, the TUI seam adapters and the runtime controller stay
 * independently testable. Nothing here imports a dsh-TUI runtime module: the
 * seam interfaces are structural copies of the host's public shapes, the same
 * discipline dsh-TUI documents for ecosystem plugins (a plugin must keep
 * loading when a seam is absent).
 *
 * @module dsh-tui-status-rotator/types
 */
import type * as React from 'react';
/** The three rotation phases the original plugin renders. */
export type Phase = 'thinking' | 'running' | 'long';
/** UI language of the phrase pool. */
export type Lang = 'zh' | 'en';
/** Condition attached to a phrase ('when' in the original bank format). */
export interface WhenCondition {
    /** A tool name (or names) currently running; '*' matches any tool. */
    readonly tool?: string | readonly string[] | '*';
    /** A step is retrying. */
    readonly retry?: boolean;
    /** Pending interactive request count (approval/question); a number means "at least". */
    readonly pending?: boolean | number;
    /** Phase gate. */
    readonly phase?: Phase | readonly Phase[];
    /** Local hour window, inclusive start / exclusive end, wraps midnight. */
    readonly hour?: readonly [number, number];
    /** First turn of the session. */
    readonly firstTurn?: boolean;
}
/** One phrase as written in a bank file. */
export type PhraseInput = string | {
    readonly text: string;
    /** Draw weight, 1..1000; omitted = 1. */
    readonly weight?: number;
    readonly when?: WhenCondition;
    /** Easter egg: participates in only this fraction of draws, (0, 1]. */
    readonly rarity?: number;
};
/** A normalized phrase entry (bank loading turns every input into this). */
export interface PhraseEntry {
    readonly text: string;
    readonly weight: number;
    readonly when?: WhenCondition;
    readonly rarity?: number;
}
/** The three phase groups as written in a bank file. */
export interface PhraseGroupsInput {
    readonly thinking?: readonly PhraseInput[];
    readonly running?: readonly PhraseInput[];
    readonly long?: readonly PhraseInput[];
}
/** The three phase groups after normalization. */
export type PhaseGroups = Readonly<Record<Phase, readonly PhraseEntry[]>>;
/** A named pack of phrases (the original "词库包"). */
export interface PackDoc {
    readonly id: string;
    readonly label?: {
        readonly zh?: string;
        readonly en?: string;
    };
    readonly phrases: {
        readonly zh?: PhraseGroupsInput;
        readonly en?: PhraseGroupsInput;
    };
}
/** A bank document: core phrases + packs + enabled-pack selection. */
export interface BankDoc {
    readonly phrases?: {
        readonly zh?: PhraseGroupsInput;
        readonly en?: PhraseGroupsInput;
    };
    readonly packs?: readonly PackDoc[];
    /** undefined/null = all packs enabled; [] = core phrases only. */
    readonly enabledPacks?: readonly string[] | null;
}
/** A fully merged, normalized bank ready for the selection engine. */
export interface MergedBank {
    readonly zh: PhaseGroups;
    readonly en: PhaseGroups;
    /** Packs that contributed at least one phrase, in merge order. */
    readonly includedPacks: readonly string[];
    /** Diagnostics from normalization (invalid entries were dropped). */
    readonly warnings: readonly BankWarning[];
}
/** A normalization warning (never thrown at boot). */
export interface BankWarning {
    readonly code: string;
    readonly message: string;
}
/** Live facts the engine conditions ('when') and placeholders read. */
export interface LiveContext {
    readonly lang: Lang;
    readonly phase: Phase;
    /** Epoch ms for the current rotation draw. */
    readonly now: number;
    /** Local hour 0..23 at now. */
    readonly hour: number;
    /** Current turn elapsed ms (0 when idle). */
    readonly elapsedMs: number;
    /** Whether a turn is currently running. */
    readonly running: boolean;
    /** Names of tools currently running, in call order. */
    readonly tool: readonly string[];
    readonly retry: number;
    readonly retryMax?: number;
    /** Pending interactive requests for the visible session. */
    readonly pending: number;
    /** First turn of the current session. */
    readonly firstTurn: boolean;
    readonly model?: string;
    readonly provider?: string;
    /** Estimated tokens/second for the current stream, when known. */
    readonly tps?: number;
    /** Extra placeholder values contributed by other plugins. */
    readonly vars?: Readonly<Record<string, string>>;
}
/** One engine draw request. */
export interface PickRequest {
    readonly bank: MergedBank;
    readonly live: LiveContext;
    /** Weighted draw when true (original default), uniform when false. */
    readonly weighted: boolean;
    /** Cross-bag anti-repeat memory length (0..50). */
    readonly antiRepeatRecentLimit: number;
}
/** The engine's choice for one rotation. */
export interface PhrasePick {
    /** Raw template text; placeholders are resolved by the renderer. */
    readonly text: string;
    readonly weight: number;
    readonly rarity: boolean;
}
/** The stateful selector: weighted draw + shuffle bag per language+phase. */
export interface SelectionEngine {
    pick(request: PickRequest): PhrasePick | undefined;
    /** Clear shuffle bags and rarity memory (config/bank changes). */
    reset(): void;
    /** Serializable state for tests/diagnostics (bag contents + recency). */
    snapshot(): SelectionSnapshot;
    restore(state: SelectionSnapshot): void;
}
/** Serializable engine memory. */
export interface SelectionSnapshot {
    readonly bags: Readonly<Record<string, readonly string[]>>;
    readonly recent: Readonly<Record<string, readonly string[]>>;
}
/** Resolve a phrase template against live facts. */
export interface PlaceholderResolver {
    /**
     * Replace every known placeholder. Unknown placeholders are left verbatim
     * and reported in unknown so diagnostics can name them.
     */
    resolve(text: string, live: LiveContext): {
        readonly text: string;
        readonly unknown: readonly string[];
    };
}
/** Resolved gradient presentation for the view component. */
export interface GradientSpec {
    /**
     * - theme: adaptive palette of host theme color keys (follows light/dark).
     * - day / night: explicit hex palettes from config.
     */
    readonly mode: 'theme' | 'day' | 'night';
    readonly direction: 'rtl' | 'ltr';
    /** Colors (theme keys or raw colors the host Text resolves). */
    readonly palette: readonly string[];
    /** Flow period in ms (one full cycle). */
    readonly speedMs: number;
}
/** The single frame the status view renders from. */
export interface ViewFrame {
    /** Monotonic revision; component re-renders when it changes. */
    readonly revision: number;
    readonly visible: boolean;
    readonly phase: Phase;
    readonly lang: Lang;
    /** Fully rendered phrase (placeholders resolved), not yet typewriter-clipped. */
    readonly text: string;
    /** Epoch ms the current phrase started showing (typewriter anchor). */
    readonly startedAt: number;
    /** Per-grapheme reveal interval; 0 = reveal all at once. */
    readonly typeSpeedMs: number;
    /** Gradient presentation, or undefined when gradients are off. */
    readonly gradient?: GradientSpec;
}
/** Minimal subscribable store shape used by the view component. */
export interface ViewStoreLike {
    readonly snapshot: ViewFrame;
    subscribe(listener: () => void): () => void;
}
/** What the runtime needs to know about the visible session right now. */
export interface SessionState {
    readonly running: boolean;
    /** Epoch ms the current turn started (0 when no turn has run). */
    readonly turnStartedAt: number;
    /** Epoch ms the first streamed token arrived in this turn (0 when none). */
    readonly firstTokenAt: number;
    /** Names of tools currently running. */
    readonly tools: readonly string[];
    readonly retry: number;
    readonly retryMax?: number;
    readonly pending: number;
    readonly firstTurn: boolean;
    readonly model?: string;
    readonly provider?: string;
    readonly tps?: number;
}
/** Phase derivation is pure and clock-injected so tests can pin time. */
export interface PhaseClockConfig {
    /** thinking -> running after this many ms of turn elapsed. */
    readonly thinkingMs: number;
    /** running -> long after this many ms of turn elapsed. */
    readonly longAfterMs: number;
}
/** Persisted preset: a named phrase snapshot plus optional config overrides. */
export interface PresetInput {
    readonly id: string;
    readonly name?: string;
    readonly phrases?: {
        readonly zh?: PhraseGroupsInput;
        readonly en?: PhraseGroupsInput;
    };
    readonly packs?: readonly PackDoc[];
    readonly enabledPacks?: readonly string[] | null;
}
/** Weekly schedule rule selecting a preset by weekday + local time window. */
export interface ScheduleRuleInput {
    readonly preset: string;
    /** ISO weekdays 1..7; omitted = every day. */
    readonly days?: readonly number[];
    /** HH:MM local, inclusive. */
    readonly from: string;
    /** HH:MM local, exclusive; earlier than from wraps midnight. */
    readonly to: string;
}
/** Fully resolved configuration used by the runtime (all defaults applied). */
export interface ResolvedConfig {
    readonly enabled: boolean;
    /** Phrase language; 'auto' resolves through env / ~/.dsh-tui/lang.json / OS locale. */
    readonly language: 'auto' | 'zh' | 'en';
    /** Rotation cadence in ms. */
    readonly intervalMs: number;
    /** Per-grapheme typewriter interval in ms; 0 = instant. */
    readonly typeSpeedMs: number;
    /** thinking -> running boundary in ms (original hard-coded 15s). */
    readonly thinkingMs: number;
    /** running -> long boundary in ms. */
    readonly longAfterMs: number;
    readonly weightedRandom: boolean;
    /** Shuffle-bag cross-bag memory length 0..50. */
    readonly antiRepeatRecentLimit: number;
    /** 'phrases' renders our line; 'host' leaves the host's own line untouched. */
    readonly labelSource: 'phrases' | 'host';
    readonly gradientEnabled: boolean;
    readonly gradientMode: 'theme' | 'day' | 'night';
    readonly gradientDirection: 'rtl' | 'ltr';
    readonly gradientColors: readonly string[];
    readonly gradientDayColors: readonly string[];
    readonly gradientSpeedSec: number;
    /** undefined = built-in default packs; [] = core only. */
    readonly enabledPacks?: readonly string[] | null;
    readonly presets: readonly PresetInput[];
    readonly schedule: readonly ScheduleRuleInput[];
    readonly activePreset?: string | null;
    /** External bank file path override; undefined = default DSH-TUI path. */
    readonly bankPath?: string | null;
}
/** One runtime diagnostic surfaced through /status-rotator status + logs. */
export interface Diagnostic {
    readonly code: string;
    readonly message: string;
    readonly at: number;
}
/** Collects diagnostics for the command/diagnostics view (bounded). */
export interface DiagnosticsSink {
    warn(code: string, message: string): void;
    list(): readonly Diagnostic[];
}
/** A phrase provider returned by another plugin, evaluated at draw time. */
export interface PhraseProviderSite {
    readonly lang: Lang;
    readonly phase: Phase;
    readonly live: LiveContext;
}
/** Public service this plugin provides for other cordis plugins. */
export interface StatusRotatorApi {
    readonly version: number;
    registerPack(pack: PackDoc): () => void;
    registerPlaceholder(name: string, resolve: (live: LiveContext) => string, options?: {
        readonly live?: boolean;
    }): () => void;
    registerPhraseProvider(provider: (site: PhraseProviderSite) => readonly PhraseInput[] | PhraseGroupsInput): () => void;
    status(): {
        readonly version: number;
        readonly host: {
            readonly richStatusView: boolean;
            readonly plainStatus: boolean;
            readonly settingsSection: boolean;
            readonly commands: boolean;
        };
        readonly engine: SelectionSnapshot;
        readonly packs: readonly string[];
        readonly diagnostics: readonly Diagnostic[];
    };
}
/** Tiny subset of the host React instance the status view receives. */
export type HostReact = typeof React;
/** Pointer/layout/text primitives the host passes to a rich status view. */
export interface TuiStatusViewUi {
    readonly Box: React.ComponentType<Record<string, unknown>>;
    readonly Text: React.ComponentType<Record<string, unknown>>;
    readonly Image: React.ComponentType<Record<string, unknown>>;
    readonly useTerminalSize: () => {
        readonly columns: number;
        readonly rows: number;
    };
}
/** Props a rich status view component receives (seam 11 registerView). */
export interface TuiStatusViewProps {
    readonly React: HostReact;
    readonly ui: TuiStatusViewUi;
}
/** Descriptor accepted by tuiStatus.registerView. */
export interface TuiStatusViewDescriptor {
    readonly key: string;
    readonly maxRows?: 1 | 2 | 3;
    readonly component: React.ComponentType<TuiStatusViewProps>;
}
/** Semantic tone for footer fields (host vocabulary; literal colors refused). */
export type TuiStatusFieldTone = 'dim' | 'accent' | 'success' | 'warning' | 'error';
/** Options accepted by tuiStatus.setField. */
export interface TuiStatusFieldOptions {
    readonly slot?: 'left-tail' | 'right-head' | 'right-tail';
    readonly tone?: TuiStatusFieldTone;
    readonly maxCells?: number;
    readonly minColumns?: number;
    readonly detail?: string;
    readonly onClick?: () => void;
}
/** Structural view of the host tuiStatus service (seam 11). */
export interface TuiStatusService {
    set(key: string, text: string | undefined, identity?: unknown): (() => void) | void;
    setField?(key: string, text: string | undefined, options?: TuiStatusFieldOptions, identity?: unknown): (() => void) | void;
    registerView?(descriptor: TuiStatusViewDescriptor, identity?: unknown): (() => void) | undefined;
}
/** Field kinds the host settings page supports (seam 6). */
export interface TuiSettingsField {
    readonly path: readonly string[];
    readonly label: string;
    readonly descriptions?: {
        readonly zh?: string;
        readonly en?: string;
    };
    readonly kind: 'text' | 'number' | 'boolean' | 'select';
    readonly hint?: string;
    readonly hintDescriptions?: {
        readonly zh?: string;
        readonly en?: string;
    };
    readonly options?: readonly {
        readonly value: string;
        readonly label: string;
        readonly descriptions?: {
            readonly zh?: string;
            readonly en?: string;
        };
    }[];
}
/** Section accepted by tuiSettingsSections.register (seam 6). */
export interface TuiSettingsSection {
    readonly ns: string;
    readonly title: string;
    readonly descriptions?: {
        readonly zh?: string;
        readonly en?: string;
    };
    readonly page?: {
        readonly id: string;
        readonly title: string;
        readonly descriptions?: {
            readonly zh?: string;
            readonly en?: string;
        };
    };
    readonly fields: readonly TuiSettingsField[];
}
/** Structural view of the host tuiSettingsSections service (seam 6). */
export interface TuiSettingsSectionsService {
    register(section: TuiSettingsSection): () => void;
}
/** One slash-command result. */
export interface CommandResult {
    readonly kind: 'success' | 'error';
    readonly text?: string;
}
/** One slash-command definition accepted by dsh-commands. */
export interface CommandDefinition {
    readonly name: string;
    readonly description?: string;
    /**
     * dsh-commands invokes handlers with its own invocation object (the raw tail
     * lives on invocation.rawInput); structural hosts may also pass the raw
     * string. Implementations accept both shapes.
     */
    readonly handler: (input: unknown) => CommandResult | Promise<CommandResult>;
}
/** Structural view of the host commands service. */
export interface CommandsService {
    register(definition: CommandDefinition): () => void;
}
/** Mediated command registration surface exposed by tuiPluginHost (C-041). */
export interface TuiPluginHostService {
    registerCommand?(pluginCtx: unknown, definition: CommandDefinition): () => void;
    registerCommand?(pluginCtx: unknown, contributionId: string, definition: CommandDefinition): () => void;
}
/** Structural view of the official-host prompt slot service (seam 2). */
export interface TuiPromptService {
    register(name: string, initialValue?: string): {
        set(value: string | undefined): void;
        dispose(): void;
    };
}
