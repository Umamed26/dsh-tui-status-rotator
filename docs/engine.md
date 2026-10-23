# Phrase engine (`src/engine/`)

Pure, clock-injected logic behind the rotating status line: phrase selection,
placeholder interpolation, typewriter/gradient render helpers and preset
scheduling. Everything in this directory is side-effect free (no I/O, no
timers, no `Date.now()`/`Math.random()` reads that cannot be injected), so the
runtime controller can pin every input and the tests can pin every output.

Port fidelity: semantics are taken from dsh-status-rotator's
`README_ZH.md` (weighted random / anti-repeat shuffle bag / conditional
phrases / placeholders / gradient / presets & schedule) and
`scripts/verify-phrase-selection.cjs`; deviations forced by the TUI
environment are called out inline below.

---

## `src/engine/selection.ts`

```ts
createSelectionEngine(options?: { rng?: () => number }): SelectionEngine

// Building blocks (exported for tests / diagnostics)
matchWhen(when: WhenCondition | null | undefined, live: LiveContext): boolean
normalizeWhen(when: WhenCondition | null | undefined): WhenCondition | undefined
selectCandidatePool(entries: readonly PhraseEntry[], live: LiveContext, rng: () => number): readonly PhraseEntry[]
normalizePhraseWeight(weight: unknown): number
normalizeRarity(rarity: unknown): number | undefined
hourInWindow(window: readonly [number, number], hour: number): boolean

MAX_PHRASE_WEIGHT = 1000   MAX_RECENT_LIMIT = 50   DEFAULT_RECENT_LIMIT = 3
```

`SelectionEngine` is the interface from `src/types.ts` (`pick`,
`reset`, `snapshot`, `restore`); `rng` defaults to `Math.random`.

### One draw, in order

1. **Candidate group** — `bank[lang][phase]` (`LiveContext.lang` /
   `LiveContext.phase`). Empty/unknown group -> `undefined` (caller hides the
   line and reports `bank.empty`).
2. **Rarity gate** — walk entries in bank order; an entry with a valid rarity in
   `(0, 1]` consumes exactly one `rng()` and participates only when
   `rng() < rarity`; rarity `1` always participates **without** consuming
   randomness; missing/invalid rarity always participates. Zero calls happen
   for entries without a gate.
   If the rolls empty the pool, the **full** pool is used again (an unlucky
   roll can never blank the status line).
3. **Conditional priority** — partition the eligible pool:
   * entries whose normalized `when` is empty/invalid are **plain**;
   * entries whose `when` matches `LiveContext` are **conditional** (fields are
     AND-ed);
   * if any conditional matched, the draw pool is **exactly the matching
     conditionals** (a `tool: "bash"` phrase must not be drowned by a thousand
     unconditional ones);
   * otherwise the plain entries; if every entry is conditional and none
     matches, the full eligible pool (line still rotates).
4. **Shuffle bag** — key ```lang|phase```. Inside one bag no text repeats.
   When the bag is empty or the candidate pool changed (phase/language/condition
   change, preset switch), the bag is refilled from the current pool's unique
   texts in bank order, first trimming the **last `antiRepeatRecentLimit`**
   texts (0..50, clamped; `0` = bag only). If trimming would empty the pool, the
   untrimmed pool is used (bag seam may repeat only when the pool is smaller
   than the memory) — same as the original `refill()`.
5. **Draw** — weighted (cumulative weights, one `rng()` call) unless
   `weighted: false` (uniform). A one-entry pool consumes **no** rng. Weights
   are clamped to `[1, 1000]`: `< 1`, non-finite or non-number -> `1`;
   `> 1000` -> `1000`. (Original README: "weight cap 1000, invalid = 1".)
6. **Remember** — the picked text is unshifted into the recency list and the
   list is truncated to the current limit; the text is removed from the bag.

The result is `{ text, weight, rarity }`: clamped weight, and `rarity` is true
when the entry declares a valid rarity (whether it passed the gate is not
exposed).

### `when` conditions

All present fields must match (AND). Invalid fields/unknown keys are dropped by
`normalizeWhen`; a rule with no usable field is **unconditional**, not
"never matches" (original behavior: a bad hand-written rule must not silently
hide a phrase).

| field | shape | meaning |
| --- | --- | --- |
| `tool` | `string` / `string[]` / `'*'` | a tool with that name is running; `'*'` = any tool. No running tool -> false. |
| `retry` | `boolean` | `true` = `live.retry > 0`; `false` is matched literally. |
| `pending` | `boolean` / `number` | `true` = at least one pending interaction; a number = "at least N". |
| `phase` | `Phase` / `Phase[]` | current phase. |
| `hour` | `[from, to]` | local hour, inclusive start / exclusive end, wraps midnight; `from === to` = **all day**. |
| `firstTurn` | `boolean` | first turn of the session. |

The TUI port only has the three rotation phases (`thinking`, `running`,
`long`): the controller hides the status line when idle, so the original
`idle` phase value cannot be observed (a hand-written `phase: "idle"` rule is
dropped by normalization).

Conditions **fail closed**: missing live facts (`{}` cast) make `tool` and
`pending` rules false, `hour` false, `retry: false`/`firstTurn: false` true.
The engine never reads the clock itself — `hour` comes from
`LiveContext.hour` and `now` from `LiveContext.now`.

### Snapshot / restore

```json
{
  "bags":   { "zh|running": ["b", "c"] },
  "recent": { "zh|running": ["a"] }
}
```

Keys are exactly ```lang|phase```. `restore` **replaces** the whole memory
(never merges), validates defensively (ignores `null`, wrong shapes, non-string
entries; never throws), and does not trim to the current limit — the next
`pick` trims so a limit change takes effect immediately.
`restore(snapshot())` is an exact round-trip.

### rng contract

`rng()` must return `[0, 1)`. Values outside the range are clamped internally
(`<=0` -> 0, `>=1` -> `1 - Number.EPSILON`), `NaN` -> 0, so a hostile injected
source cannot index out of bounds. Pinned rngs make the entire draw sequence
reproducible (used by every test).

---

## `src/engine/placeholders.ts`

```ts
createPlaceholderResolver(): PlaceholderResolver          // from src/types.ts
formatElapsed(ms: number, lang: Lang): string

BUILTIN_PLACEHOLDER_NAMES: ReadonlySet<string>            // the 15 built-ins
PLACEHOLDER_NAME_PATTERN: RegExp                          // /^[A-Za-z][A-Za-z0-9_-]{0,31}$/
isBuiltinPlaceholder(name: string): boolean
```

`resolve(text, live)` returns `{ text, unknown }`; `unknown` names every
`{name}` that could not be resolved (first-seen order, de-duplicated).

| placeholder | value |
| --- | --- |
| `{elapsed}` | localized `LiveContext.elapsedMs`: zh `1分02秒` / en `1m 02s` (hours: zh `1小时0分00秒`, en `1h 0m 0s`) |
| `{phase}` | `thinking` / `running` / `long` |
| `{phaseLabel}` | zh: `思考中` / `运行中` / `长任务中`; en: `thinking` / `running` / `long-running` (same table as `src/locale.ts`) |
| `{model}`, `{provider}` | value, or `—` when the host does not expose it |
| `{tps}` | rounded tokens/second, or `''` when unknown |
| `{pending}` | floored pending count, invalid/negative -> `0` |
| `{tools}` | running tool names joined with `+`, or `—` |
| `{running}` | `run` / `idle` |
| `{retry}`, `{retryMax}` | retry count / cap while retrying, else `''` |
| `{locale}` | `LiveContext.lang` (`zh` / `en`) |
| `{date}`, `{time}` | local `YYYY-MM-DD` / `HH:MM:SS` from `LiveContext.now` (invalid time -> `''`) |
| `{detail}` | observation badge: `⟳ 3/5` while retrying, `⟳ 3` without a cap, else `''` |

### Precedence contract (decided)

1. **Built-ins always win.** A built-in name is always replaced by the
   built-in value, even if `LiveContext.vars` contains the same name.
2. **`LiveContext.vars` fills the rest.** A var is used only when its name is
   not built-in and its value is a string (other plugin placeholders arrive
   here through the extension service).
3. **Unknown names stay verbatim** and are reported. Names that do not match
   `PLACEHOLDER_NAME_PATTERN` (e.g. `{123}`, `{not a placeholder}`) are not
   placeholders at all: left verbatim and not reported.
4. **Registration is a service concern.** `registerPlaceholder(name, …)` MUST
   throw when `name` is reserved, and the service owns name validation.
   `src/runtime/service.ts` imports `BUILTIN_PLACEHOLDER_NAMES` as the single
   source of truth (`RESERVED_PLACEHOLDERS`), so the two cannot drift.

Formatting note: the original web plugin rendered `{model}`/`{provider}` as
`—` and `{tps}` as the raw integer; the TUI port keeps those fallbacks and
rounds `tps` to an integer so a live stream does not jitter the width.

---

## `src/engine/render.ts`

```ts
textGraphemes(text: string): readonly string[]
revealCount(text: string, startedAt: number, typeSpeedMs: number, now: number): number
gradientColors(spec: GradientSpec, count: number, now: number, startedAt: number): readonly string[]
resolveGradientSpec(config: ResolvedConfig): GradientSpec | undefined
```

### Graphemes

`textGraphemes` uses `Intl.Segmenter` (grapheme granularity) and falls back to
`Array.from` when unavailable, so the typewriter and gradient never split an
emoji/ZWJ sequence or a combining mark.

### Typewriter

```
typeSpeedMs <= 0            -> all graphemes
elapsed <= 0                -> 1 grapheme (first char appears immediately: no blank frame)
otherwise                   -> min(total, 1 + floor(elapsed / typeSpeedMs))
```

The view renders `graphemes.slice(0, revealCount(...))`. `startedAt` is the
frame's `ViewFrame.startedAt` epoch ms; the component passes its clock as
`now`.

### Gradient: per-cell palette sweep (terminal model)

Terminal cells cannot interpolate colors, so instead of the web plugin's CSS
background-gradient animation the view paints **one palette color per
grapheme** and animates by shifting the palette index:

```
L      = palette.length
i      = grapheme index (0-based)
t      = max(0, now - startedAt)
step   = speedMs > 0 ? floor(t / speedMs * L) : 0
dir    = direction === 'ltr' ? -1 : 1        // rtl is the default
color  = palette[(i + dir * step) mod L]
```

Properties:

* **one full cycle per `speedMs`**: after `speedMs`, `step` advanced by `L`, so
  `dir * L mod L = 0` and the frame is identical (seamless loop);
* within a cycle the whole palette shifts one entry every `speedMs / L`
  (e.g. 7 colors / 4000ms -> ~571ms per step), which is the crisp "rainbow
  stripe" look terminals can draw; adjacent cells are adjacent palette entries;
* **direction** — `rtl` moves the pattern right-to-left, `ltr` left-to-right.
  At `t = 0` both produce the same spatial sequence (`palette[i]`); only the
  motion differs;
* `speedMs <= 0` / invalid -> static spatial pattern; non-positive or
  non-finite `count` -> `[]`; the returned array length is exactly
  `floor(count)`;
* pinned `now`/`startedAt` -> identical array (the view stays a pure function
  of frame + clock).

### `resolveGradientSpec`

| config | spec |
| --- | --- |
| `gradientEnabled: false` (or empty palette) | `undefined` -> plain text |
| `gradientMode: 'theme'` | palette = `THEME_GRADIENT_PALETTE` from `src/config.ts` (host theme color keys, resolved by the view per light/dark theme) |
| `gradientMode: 'day'` | palette = `gradientDayColors` |
| `gradientMode: 'night'` | palette = `gradientColors` |
| any mode | `direction` = `gradientDirection` (`rtl` fallback), `speedMs = clamp(gradientSpeedSec, 1..60) * 1000` (invalid -> 4000) |

The theme palette has exactly one source (`src/config.ts`); `render.ts` imports
it, it is not duplicated.

---

## `src/engine/schedule.ts`

```ts
resolveActivePreset(
  presets: readonly PresetInput[],
  schedule: readonly ScheduleRuleInput[],
  activePreset: string | null | undefined,
  at: Date,
): { presetId: string | null; warnings: readonly BankWarning[] }

isoWeekday(day: number): number    // Date.getDay(): 0 -> 7, 1..6 unchanged, invalid -> 0
```

Resolution order (documented contract):

1. **First matching rule wins** in array order.
2. A matching rule whose `preset` id is not defined in `presets` is **ignored
   with a warning** and scanning continues — a typo must not pin the wrong
   bank.
3. No rule matches -> `activePreset` if defined; `null` = built-in bank.
   An `activePreset` naming an undefined preset -> `null` + warning.
4. `activePreset` null/undefined -> `null`.

Rule matching:

* `days` are **ISO weekdays 1..7** (Monday 1 … Sunday 7). Omitted = every day;
  an explicit empty list = never. Out-of-range day numbers are ignored.
* `from`/`to` are local `HH:MM`, **inclusive start / exclusive end**.
  `from < to` is a normal window; `from > to` wraps midnight
  (`22:00` -> `06:00` covers 22:00–23:59 and 00:00–05:59).
* `from === to` is a **zero-length window and never matches** — exactly the
  original `matchSchedule` semantics. (The `when.hour` condition uses the
  opposite convention: equal bounds = all day. This difference is inherited,
  not invented; write `00:00` -> `23:59` for an all-day schedule rule.)
* An invalid `Date` cannot be evaluated: warning + fall back to
  `activePreset`.
* Malformed rules (missing/non-`HH:MM` times) are warned about and skipped.

Warning codes: `schedule.invalidDate`, `schedule.invalidRule`,
`schedule.unknownPreset`, `preset.unknownActive`. Warnings are a fresh array
per call; the runtime forwards them to the diagnostics sink.

---

## How the runtime wires it

`src/runtime/controller.ts` is the only caller:

* `createSelectionEngine({ rng })` once; `pick({ bank, live, weighted,
  antiRepeatRecentLimit })` on each rotation; `engine.reset()` on bank/source
  changes.
* `createPlaceholderResolver()` once; `resolve(rawText, live)` on every
  publish (also refreshes live placeholders); unknown names go to
  `diagnostics`.
* `resolveGradientSpec(config)` on every publish and stored in the frame.
* `resolveActivePreset(presets, schedule, activePreset, new Date(now))` each
  tick; a changed `presetId` swaps the effective bank.

`src/tui/status-view.ts` reads the frame and uses `textGraphemes`,
`revealCount` and `gradientColors` to render one cell per grapheme.

## Tests

`test/engine/` (`node:test`, 81 tests) imports the **built** output
(`lib/types/engine/*.js`); package.json's `npm test` is
`npm run build && node --test`, so a stale build can never be tested.
Coverage:

* `selection.test.ts` — bag no-repeat, bag-seam anti-repeat for
  `recentLimit` 2/0/50/negative, pool-change reset, per-language+phase keys,
  weight clamp `1..1000`, weighted vs uniform, seeded first-draw ratio,
  conditional priority, plain fallback, all-conditional fallback, AND
  conditions, rarity gate (participation/fallback/`rarity=1` consumes no rng),
  hour window (normal + midnight wrap + equal bounds), `firstTurn`/`retry`/
  `pending`/`tool`/wildcard, fail-closed live facts, snapshot/restore
  round-trip + continuation + corrupt-state tolerance, reset, malformed banks.
* `placeholders.test.ts` — zh/en `formatElapsed` table (s/min/h), all 15
  built-ins, `—`/`''` fallbacks, tps rounding, pending flooring, tools join,
  detail badge, local date/time from pinned `now`, unknown reporting with
  de-dupe, vars precedence (built-in wins), non-string vars, empty text,
  reserved-name registry and name pattern.
* `render.test.ts` — grapheme segmentation (ASCII/CJK/emoji/ZWJ/combining),
  reveal count boundaries and speed 0, one color per grapheme, rtl/ltr
  direction, full-cycle seamlessness, pinned-clock stability, static pattern,
  invalid inputs, `resolveGradientSpec` for disabled/theme/day/night/speed
  clamp/empty palette, end-to-end gradient from resolved spec.
* `schedule.test.ts` — ISO weekday mapping, first-match order, half-open
  bounds, weekday filters incl. Sunday=7, omitted/empty days, midnight wrap,
  `from === to`, unknown preset skip+continue, activePreset fallback/unknown,
  malformed rules, invalid date, empty inputs, fresh warning arrays.
