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
export {};
