import type { BankDoc } from '../types.js';
/** Environment variable overriding the bank file path. */
export declare const EXTERNAL_BANK_ENV = "DSH_TUI_STATUS_ROTATOR_BANK";
/** File name inside the plugin data directory. */
export declare const EXTERNAL_BANK_FILE = "bank.json";
/** Poll interval for the file watcher, in milliseconds. */
export declare const EXTERNAL_BANK_POLL_MS = 2000;
/** Loader state exposed for the \`/status-rotator status\` command and tests. */
export interface ExternalBankStatus {
    /** Whether the last load attempt ended without an error. */
    readonly ok: boolean;
    /** Absolute path of the watched file. */
    readonly path: string;
    /** Whether a document from this file is currently in effect. */
    readonly loaded: boolean;
    /** Last load error (parse/validation/read); null after a success or when missing. */
    readonly error: string | null;
    /** Number of successful document changes since \`start()\`. */
    readonly reloads: number;
    /** Epoch ms of the last successful load, null before the first one. */
    readonly lastLoadedAt: number | null;
}
/** Handle returned by {@link createExternalBank}. */
export interface ExternalBankHandle {
    /** Load once and start watching the file (idempotent). */
    start(): void;
    /** Stop watching (idempotent); status keeps its last value. */
    stop(): void;
    /** Current status snapshot. */
    status(): ExternalBankStatus;
    /** Last good normalized document, or null when the external layer is off. */
    current(): BankDoc | null;
    /** Force one immediate load/validation pass (used by tests). */
    reloadNow(): void;
}
/** Options accepted by {@link createExternalBank}. */
export interface ExternalBankOptions {
    /** Plugin data directory; default \`~/.dsh-tui/status-rotator\`. */
    readonly dir?: string;
    /** Explicit file path (config \`bankPath\`); wins over the env var and dir. */
    readonly file?: string | null;
    /** Environment used for \`DSH_TUI_STATUS_ROTATOR_BANK\` (default \`process.env\`). */
    readonly env?: NodeJS.ProcessEnv;
    /** Called with every accepted document (including the initial load). */
    readonly onReload: (doc: BankDoc) => void;
    /** Clock injection for \`lastLoadedAt\` (default \`Date.now\`). */
    readonly now?: () => number;
    /** Diagnostic sink for load errors and normalization warnings. */
    readonly log?: (code: string, message: string) => void;
}
/** Default external-bank directory: \`<home>/.dsh-tui/status-rotator\`. */
export declare function defaultExternalBankDir(env?: NodeJS.ProcessEnv): string;
/** Expand a leading \`~\` and resolve relative paths against the process cwd. */
export declare function expandBankPath(path: string, env?: NodeJS.ProcessEnv): string;
/**
 * Resolve the bank file path from options, then the environment, then the
 * default directory. Kept pure so the path precedence is testable.
 */
export declare function resolveExternalBankPath(options?: Pick<ExternalBankOptions, 'dir' | 'file' | 'env'>): string;
/**
 * Create the external-bank loader (no side effects until \`start()\`).
 *
 * Loading never throws: every failure path keeps the last good document and
 * reports through \`log\` / \`status()\`.
 */
export declare function createExternalBank(options: ExternalBankOptions): ExternalBankHandle;
