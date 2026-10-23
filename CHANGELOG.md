# Changelog

## 0.1.0

- Port dsh-status-rotator to dsh-TUI: phase-aware rotating status phrases on the
  `tuiStatus.registerView` rich status seam, with plain `tuiStatus.set` fallback.
- Typewriter reveal and per-cell flowing gradient (theme-adaptive palette, plus
  explicit day/night palettes).
- Weighted random, per language+phase shuffle bags, cross-bag anti-repeat memory,
  conditional phrases (`when`) and rarity.
- Live placeholder resolution (elapsed / phase / pending / tools / retry / ...).
- 14 built-in phrase packs (1362 entries) ported verbatim, with pack selection
  and notes/ads/star packs disabled by default like the original.
- Presets and weekday/time schedule.
- External hot-reload phrase bank at `~/.dsh-tui/status-rotator/bank.json`
  (env/config override, last-good fallback, visible diagnostics).
- Native `/settings` section over the plugin config namespace.
- `/status-rotator` command: next | on | off | status.
- `ctx.statusRotator` extension API: register packs, placeholders and phrase
  providers (explicit-failure registration).
- Diagnostics surfaced through the host logger and the status command; every
  missing seam / corrupt bank / invalid config degrades to a no-op with a reason.
- Deferred seam wiring: host services (`tuiStatus`, `tuiSettingsSections`,
  `commands`) are registered through `ctx.inject` so a plugin row that activates
  concurrently with the TUI extension rows still lands its view, section and
  command (found and fixed during real-TTY replay; one-shot probing silently
  missed every seam).
- Phase/activity source consumes the host `sessionProjections`
  `workingActivity` view (the same data the TUI status line reads) with the
  session-event tracker as fallback; subagent sessions never take over the line.
- Diagnostics snapshot compacted to one host-truncation-safe line:
  enabled/lang/phase, four seam flags, tracker/projection/event/frame counters,
  pack count, current phrase and recent error codes.
- Debug channel for replay forensics: `DSH_TUI_STATUS_ROTATOR_DEBUG=1` (stderr)
  and optional `DSH_TUI_STATUS_ROTATOR_DEBUG_FILE` (file), never stdout.
- Tests run with `--test-concurrency=2` to keep the `fs.watchFile` external-bank
  tests deterministic under load; `npm run verify` covers build, manifest,
  bank audit and 209 tests.
