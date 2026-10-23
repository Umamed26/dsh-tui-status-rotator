# dsh-TUI integration

How `dsh-tui-status-rotator` attaches to the terminal host: which seams it uses,
what the host gives back, how every seam degrades, and the exact engine helpers
the rich view consumes. The contracts are the structural copies in
[`src/types.ts`](../src/types.ts) (the package never imports dsh-TUI runtime
modules, so it keeps loading on hosts that do not have them).

Status: implemented in `src/tui/`, covered by `test/tui/*.test.ts`.
Verified against dsh-TUI source at `/tmp/dsh-port-src/dsh-TUI`
(`src/dsh-adapter/status.ts`, `src/dsh-adapter/settings-sections.ts`,
`src/dsh-adapter/plugin-host.ts`, `scripts/verify-extension-ui.tsx`).

## File map

| File | Responsibility |
| --- | --- |
| `src/tui/host.ts` | Soft-probe every seam once (`ctx.get(name, false)`), resolve the profile row id, return `{ ports, diagnostics }`. Also `safeDispose`/`disposeAll` cleanup helpers. |
| `src/tui/status-view.ts` | Seam 11 rich view: `createStatusViewComponent(store)` + `registerRichStatus(ctx, ports, store, diagnostics)`. |
| `src/tui/plain-status.ts` | Seam 11 plain fallback: `createPlainStatusBridge(ports, diagnostics)` → `{ update, dispose }`. |
| `src/tui/settings-section.ts` | Seam 6 declaration: `buildSettingsSection(ns)` + `registerSettingsSection(ctx, ports, { ns, diagnostics })`. |
| `src/tui/commands.ts` | `/status-rotator` registration: `registerStatusCommand(ctx, ports, deps)`. |

`src/index.ts` wires them: probe once, register the rich view, fall back to the
plain bridge when the rich view is refused, register settings + command, and
release every disposer from one `ctx.effect` teardown.

## Host seam map

| Feature | dsh-TUI seam | Service id | Required | Degradation |
| --- | --- | --- | --- | --- |
| Rotating line (animated) | 接缝十一 `tuiStatus.registerView` | `tuiStatus` | no | plain `tuiStatus.set` text (no typewriter/gradient) |
| Rotating line (plain) | 接缝十一 `tuiStatus.set` | `tuiStatus` | no | line hidden + diagnostic |
| /settings section | 接缝六 `tuiSettingsSections.register` | `tuiSettingsSections` | no | edit `cordis.patch.yml` / `~/.dsh/settings.yaml` by hand |
| /status-rotator | dsh-commands `commands.register` / mediated `tuiPluginHost.registerCommand` | `commands`, `tuiPluginHost` | no | command unavailable + diagnostic |
| Prompt slot (official TUI) | 接缝二 `tuiPrompt.register` | `tuiPrompt` | no | skipped (dsh-TUI never mounts this seam) |

Probing is always `ctx.get(name, false)` — the #183 rule: a missing extension
row must never take the host down. Each seam is additionally type-checked
(function-existence only) before it is used.

### `probeHostPorts` diagnostics

`probeHostPorts(ctx, 'status-rotator')` never throws and returns
`{ ports: HostPorts, diagnostics: readonly { code, message }[] }`. The caller
(`src/index.ts`) forwards them to the runtime diagnostics ring buffer, which
`/status-rotator status` prints.

| code | meaning |
| --- | --- |
| `host.no-context` | the context has no `ctx.get`; every seam is unavailable |
| `host.probe-failed` | `ctx.get(name, false)` threw (the failing seam name is in the message) |
| `host.missing-tuiStatus` | `tuiStatus` not mounted → line hidden |
| `host.invalid-tuiStatus` | `tuiStatus` has neither `set` nor `registerView` |
| `host.no-registerView` | `set` exists but `registerView` does not → plain-only mode |
| `host.missing-tuiSettingsSections` / `host.invalid-tuiSettingsSections` | no `/settings` section |
| `host.missing-commands` / `host.invalid-commands` | no `/status-rotator` command |
| `host.missing-tuiPluginHost` / `host.invalid-tuiPluginHost` | mediated command registration unavailable → direct fallback (attribution lost) |
| `host.missing-tuiPrompt` / `host.invalid-tuiPrompt` | optional prompt slot skipped (normal on dsh-TUI) |

The entry id (settings namespace, also the command's presentation label) is
`ctx.fiber.entry.options.id` — the profile row id from `cordis.patch.yml`
(`status-rotator`). When the context has no Loader entry (bare composition,
embedding, tests) the documented fallback `'status-rotator'` is used.

## Seam 11 — rich status view (`registerView`)

Host contract (dsh-TUI `src/dsh-adapter/status.ts`):

```ts
tuiStatus.registerView(
  { key, maxRows?: 1 | 2 | 3, component: (props: { React, ui }) => ReactNode },
  identity?: Context,
): (() => void) | undefined
```

- Key `'status-rotator'` (host regex `/^[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)*$/`).
- `maxRows: 1` — the host clips the view to one terminal row.
- The component receives the **host's React instance** and a pointer-only kit
  `{ Box, Text, Image, useTerminalSize }`; it gets no data props and no input.
- The optional second argument is the plugin's own `ctx`: the host effect
  ledger attributes the registration to this activation and releases it on
  unload. We always pass it.
- The host returns `undefined` when it refuses (duplicate key, row budget,
  invalid descriptor); it logs the reason. We treat `undefined` as "fall back to
  plain text" and report `status.register-view-refused`.
- One crashing view is contained by the host's `PluginStatusViewBoundary`; a
  throw from our render is reported by the host and the view disappears.

### Component behavior (`createStatusViewComponent`)

Data flow: `src/runtime/store.ts#ViewFrameStore` (a `ViewStoreLike`) is captured
by closure; the component reads `store.snapshot` through
`props.React.useSyncExternalStore` (the store keeps a referentially stable
snapshot, required by React 19).

- **Hidden frame** (`frame.visible === false`): returns `null` — no row is
  reserved. Empty text is treated the same way (degenerate visible frame).
- **Typewriter**: `revealCount(frame.text, frame.startedAt, frame.typeSpeedMs,
  now)` graphemes are shown; `typeSpeedMs === 0` shows everything at once.
- **Gradient**: when `frame.gradient` is defined, the revealed graphemes are
  painted with `gradientColors(frame.gradient, count, now, frame.startedAt)` —
  one host `Text` per grapheme so each cell gets its own color. `theme` mode
  palette entries are host theme keys (`accent`, `activity`, …), which the
  themed `Text` resolves per light/dark theme; `day`/`night` modes carry hex
  palettes from config.
- **Phase indicator**: one dim cell — `◌` thinking, `●` running, `◍` long
  (unknown phase degrades to `·`).
- **Width**: `ui.useTerminalSize().columns` is a cell budget (CJK/emoji ≈ 2
  cells, combining marks 0). The visible prefix is fitted here and the host
  `Text` also gets `wrap="truncate-end"`; when the line does not fit, one cell
  is reserved for `…`.
- **Animation policy**: an 80 ms interval runs only while the line is visible
  **and** (the typewriter is still revealing or a gradient is flowing). Fully
  revealed + gradients off ⇒ the timer is cleared; hidden ⇒ no timer, no row.
- **React rule**: hooks come from `props.React`; elements from
  `props.React.createElement`. `react` is imported type-only, never at runtime,
  so the package cannot introduce a second React copy.

### Plain fallback (`createPlainStatusBridge`)

Used when `registerView` is absent or refused. `update(text)` writes
`tuiStatus.set('status-rotator', text)`; `undefined`/whitespace-only clears it;
text is collapsed to one line and capped at 200 cells (`…`). The host's return
value may be `void` or a token-scoped disposer; both are handled, and the
previous write's disposer is released before the next write (the host never lets
a stale disposer clear a newer value). `dispose()` releases the token and clears
the contribution. Deliberately no animation: the fallback is a single host line,
not a component.

## Seam 6 — settings section

`tuiSettingsSections.register(section)` is declarative: the host renders the
form, stages edits, and writes them as revision-fenced `settings.mutate` path
ops. The section namespace is the profile row id (`ports.entryId`), i.e. the
namespace the row's Schemastery `Config` owner registers. Inline semantics:

- The section declares its own page tab (id = namespace, title
  "Status rotator" / "状态轮换") when the namespace is a legal page id; the
  fallback joins the default "general" page.
- 15 fields, exactly the Schemastery-volatile keys of `src/config.ts`
  (`EDITABLE_KEYS`): `enabled`, `language`, `intervalMs`, `typeSpeedMs`,
  `thinkingMs`, `longAfterMs`, `weightedRandom`, `antiRepeatRecentLimit`,
  `labelSource`, `gradientEnabled`, `gradientMode`, `gradientDirection`,
  `gradientColors`, `gradientDayColors`, `gradientSpeedSec`.
  Every field has an English label/hint (host fallback) plus zh/en
  `descriptions`/`hintDescriptions`; selects carry localized option labels
  (`language`: auto/zh/en, `labelSource`: phrases/host, `gradientMode`:
  theme/day/night, `gradientDirection`: rtl/ltr).
- Advanced keys (`enabledPacks`, `presets`, `schedule`, `activePreset`,
  `bankPath`) are intentionally **not** in the form: the host's field kinds
  cannot edit nested arrays; they stay profile-patch / bank-file territory.
- The host's `register` can throw (invalid/duplicate ns); that is caught and
  reported as `settings.register-failed`, never propagated. Missing seam →
  `settings.unavailable` and `undefined`.

## dsh-commands — `/status-rotator`

Definition: `{ name: 'status-rotator', description: t(lang,'cmd.description'),
handler }`. `description` is English-or-Chinese depending on the resolved
language; the command is registered only if a registration surface accepts it.

Registration precedence:

1. **Mediated** — `tuiPluginHost.registerCommand(ctx, definition)` when
   present. The host resolves the manifest contribution id (`contributes.commands`
   id that equals the command name or ends with `.<name>`; `dsh-plugin.json`
   declares `io.github.umamed26.dsh-tui-status-rotator.status-rotator`), registers
   through dsh-commands and stamps the verified component identity (C-041) so
   per-plugin `commands.invoke` denies apply.
2. **Direct fallback** — `commands.register(definition)` when the mediated
   surface is absent, or when it throws (typical causes: commands service not
   mounted on that ctx, manifest binding mismatch, duplicate name). The command
   keeps working, loses attribution, and the degradation is reported as
   `command.mediated-failed` (visible in `/status-rotator status`).
3. Neither surface accepts → `command.unavailable`, returns `undefined`.

Handler input: dsh-commands passes its invocation object
(`{ commandId, agent, rawInput, attachments, signal }`); structural hosts may
pass the raw string. Both are accepted; only the tail after the command name is
consumed.

### Exact command output

Language comes from `deps.lang()` (the runtime passes the resolved phrase
language); without it the command auto-detects (DSH_TUI_LANG →
`~/.dsh-tui/lang.json` → OS locale → zh).

| input | side effect | result | text (zh / en) |
| --- | --- | --- | --- |
| `/status-rotator` (no arg) | none | success | multi-line status snapshot (same as `status`) |
| `/status-rotator status` | none | success | `deps.statusText()` — 5 lines: header/enabled/phase, current line, packs+preset, host seams, last diagnostics (each line kept well under 200 cells) |
| `/status-rotator next` | `controller.next()` | success | 已换下一句 / advanced to the next phrase |
| `/status-rotator on` | `controller.setEnabled(true)` | success | 已启用（本次运行；长期设置请到 /settings） / enabled for this run (persist via /settings) |
| `/status-rotator off` | `controller.setEnabled(false)` | success | 已停用（本次运行；长期设置请到 /settings） / disabled for this run (persist via /settings) |
| unknown subcommand | none | error | 未知子命令，可用：next \| on \| off \| status (<token>) / unknown subcommand, use: next \| on \| off \| status (<token>) |
| handler throws | none | error | `status-rotator: <one-line reason>` |

`/status-rotator status` always returns a result (diagnostics are capped by the
runtime ring buffer, last 3 shown) so a degraded host is diagnosable from the
TUI itself. The command surface truncates long lines by cells; the builder in
`src/index.ts` keeps each line short.

## Engine helper contract consumed by the view

The view is a pure function of `frame + clock`; it imports these from
`src/engine/render.ts` (implemented by the engine module, tested in
`test/engine/`):

```ts
textGraphemes(text: string): readonly string[]
// Intl.Segmenter grapheme split; falls back to code points.

revealCount(text: string, startedAt: number, typeSpeedMs: number, now: number): number
// 0 <= speed => all graphemes; first grapheme at startedAt, then one per speed;
// clamp [1, total]; cap at total.

gradientColors(spec: GradientSpec, count: number, now: number, startedAt: number): readonly string[]
// Exactly `count` colors, one per grapheme; palette cycle
// color(i) = palette[(i + dir * step) mod L], step advances one palette entry
// per speedMs/L; empty array when the palette is unusable (view then renders
// plain text). A pinned (now, startedAt) makes the output deterministic.
```

The view never calls `resolveGradientSpec` (the runtime controller already
resolved the config into `frame.gradient`), so gradient mode/day/night semantics
live in one place. `revealCount`/textGraphemes/gradientColors are wrapped in
try/catch: a helper bug degrades to plain, unclipped text instead of a crashing
view.

## Lifecycle and cleanup

- Rich view: host disposer stored by `index.ts` and called from its
  `ctx.effect` teardown. Passing our ctx as identity means the host also
  releases it if the activation goes away first; both paths are idempotent.
- Plain bridge: `dispose()` releases the write token and clears the key.
- Settings section: host disposer removes the section.
- Command: mediated/direct disposer removes the command (the mediated path also
  lifts the attribution stamp).
- All disposers are called inside try/catch (`safeDispose` or the index.ts
  teardown); a failing cleanup becomes a diagnostic, never an unload crash.
- Fast refresh / re-activation is safe: the host rejects a duplicate rich-view
  key with `undefined`, which routes to the plain fallback for that activation;
  the next unload frees the key.

## Degradation matrix

| host composition | presented surface |
| --- | --- |
| full dsh-TUI (status + settings + commands + plugin host) | 1-row animated rich view; native settings tab; attributed /status-rotator |
| `tuiStatus` without `registerView` (older patch) | plain keyed status text, no animation; `status.register-view` diagnostic |
| rich view refused (duplicate key / row budget) | plain keyed status text; `status.register-view-refused` diagnostic |
| no `tuiSettingsSections` | no settings tab; `settings.unavailable` (edit patch/settings.yaml) |
| no `tuiPluginHost` | direct-command fallback; `command.mediated-failed` only if mediated was present but rejected, else `host.missing-tuiPluginHost` |
| no `commands` | no command; `host.missing-commands` |
| Web / headless host (no TUI seams at all) | plugin loads, no-op, all diagnostics in the host log |

## Tests

`test/tui/` (node:test, imports the **built** `lib/types/tui/*.js`, so run
`npm run build` first — the package's `test` script does):

- `host.test.ts` — probe with all/partial/no seams, hostile `ctx.get`, entry-id
  resolution, diagnostic codes, `safeDispose`/`disposeAll` isolation.
- `status-view.test.ts` — component contract with fake host React/Box/Text:
  hidden → null, phase indicator, typewriter prefix, per-grapheme gradient
  colors, width truncation with ellipsis, registration descriptor/key/maxRows,
  refusal and missing-seam diagnostics, plain fallback updates + cleanup.
- `settings-section.test.ts` — 15 fields (exactly the editable keys), kinds,
  select options, zh/en copy, page declaration, registration/disposal and
  thrown-register degradation.
- `commands.test.ts` — mediated registration + disposer, direct fallback
  (absent and throwing mediated path), unknown subcommands, `next`/`on`/`off`/
  `status` dispatch, invocation-object input, error containment, language
  selection.
- `plugin-lifecycle.test.ts` — boots the built plugin entry (`lib/types/index.js`)
  through a fake cordis ctx: every registration is released by the plugin
  unload effect, a seam-less host boots as a documented no-op, the plain
  fallback is driven on rotation and cleared on unload, and a rejected mediated
  command falls back to the direct seam and is still unloaded.

## Known assumptions / coordination points

1. `registerView` is present in the checked-out dsh-TUI source and re-exported
   by `@deepseek-harness-tui/dsh-tui/extensions`; the older snapshot of
   `tui-profile/docs/plugin-admission-and-development.md` documents seam 11
   without it. The plugin feature-detects the method, so both host vintages load.
2. `tuiStatus.set`'s return type differs across host versions (`void` vs
   disposer); the plain bridge accepts both.
3. Host `Text` accepts theme color keys for gradient `theme` mode
   (dsh-TUI's ThemedText resolves them); day/night palettes are literal colors.
4. Cell-width fitting is an approximation (not a full wcwidth table); the host's
   `wrap="truncate-end"` is the final authority, so the approximation can only
   under-fill, never overflow.
5. Command message language is supplied by `deps.lang()`; the standalone
   auto-detection fallback exists so the module is usable without the runtime.