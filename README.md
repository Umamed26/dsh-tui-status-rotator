# dsh-tui-status-rotator

> Port of [dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator) to [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI): **phase-aware rotating status phrases, typewriter reveal, theme-adaptive gradient, weighted shuffle-bag anti-repeat, 14 phrase packs, conditional phrases, live placeholders, presets and weekday schedule** - wired into dsh-TUI's native `/settings` section and `/status-rotator` command.

[中文](./README_ZH.md) · [Install](#install) · [Settings](#settings) · [Commands](#commands) · [Advanced config](#advanced-config) · [Port differences](#differences-from-the-web-original) · [Troubleshooting](#troubleshooting)

This is a **dsh-TUI ecosystem plugin** for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It renders one rotating phrase line above the prompt - the same semantics as the web plugin, on the terminal host's own seams.

## What it looks like

While a turn runs, a line above the prompt rotates (real TTY frame examples; `◌` / `●` / `◍` are the phase glyphs):

```text
◌ 正在自刎归天…
● 正在灰度一个不该上线的功能…
```

- Typewriter reveal; after the phrase settles it rotates at the configured interval;
- Each grapheme is colored from a flowing palette (host theme palette by default, adapts to light/dark themes);
- Phase transitions (thinking ◌ -> running ● -> long ◍) swap the phrase immediately;
- Idle sessions, finished turns, disabled plugin: the line renders nothing - no placeholder row, no flicker, no focus stealing;
- Coexists with the host's own working-activity line: this plugin only adds its own row.

## Install

Requires dsh-TUI **v0.16+** (seams `tuiStatus.registerView` / `tuiSettingsSections`). The package ships `dsh-plugin.json` (Community v0.15 declaration surface) and `cordis.patch.yml` (profile composition row).

```sh
# from npm (once published)
dsh plugin --profile dsh-tui add dsh-tui-status-rotator

# local development: build, then install the package directory
npm install && npm run build
dsh plugin --profile dsh-tui add file:/absolute/path/to/dsh-tui-status-rotator
```

Restart dsh-TUI and start a turn. Uninstall:

```sh
dsh plugin --profile dsh-tui remove dsh-tui-status-rotator
```

`remove` never deletes user data: the external bank file and the plugin's data stay in `~/.dsh-tui/status-rotator/`; see [Uninstall and data](#uninstall-and-data).

## Settings

`/settings` gains a **"Status rotator"** page (seam `tuiSettingsSections`). Every field applies live and is persisted through the host's revision-fenced settings writes - no restart needed; reverting a value to its default also removes the profile override. A real-TTY replay verified the toggle -> persist -> hot-apply -> revert-default loop (see [docs/real-tty-replay.md](./docs/real-tty-replay.md)).

| Field | Default | Range | Meaning |
| --- | --- | --- | --- |
| `enabled` | `true` | on/off | Master switch; off renders nothing |
| `language` | `auto` | auto / zh / en | Phrase language; auto reads `DSH_TUI_LANG` -> `~/.dsh-tui/lang.json` -> system locale |
| `intervalMs` | `10000` | 500-600000 | Rotation interval (ms) |
| `typeSpeedMs` | `30` | 0-2000 | Typewriter per-grapheme interval; 0 = instant |
| `thinkingMs` | `15000` | 0-600000 | "thinking" phase duration before "running" |
| `longAfterMs` | `60000` | 0-3600000 | "long" phase threshold |
| `weightedRandom` | `true` | on/off | Weighted draw; off = uniform |
| `antiRepeatRecentLimit` | `3` | 0-50 | Cross-bag recency memory (0 = bag-only) |
| `labelSource` | `phrases` | phrases / host | `host` = leave the host line untouched |
| `gradientEnabled` | `true` | on/off | Per-cell flowing gradient |
| `gradientMode` | `theme` | theme / day / night | `theme` = host theme color keys (adapts); day/night = custom palettes |
| `gradientDirection` | `rtl` | rtl / ltr | Flow direction |
| `gradientColors` | original night palette | >= 2 colors | Custom night palette (hex / rgb() / ansi256() / ansi:name / host theme key, comma separated) |
| `gradientDayColors` | original day palette | >= 2 colors | Custom day palette |
| `gradientSpeedSec` | `4` | 1-60 | Seconds per gradient cycle |

Nested structures (`presets`, `schedule`, `enabledPacks`, `bankPath`) are edited in the profile row config, not the declarative form; see below.

## Commands

```text
/status-rotator next      # rotate immediately
/status-rotator on|off    # runtime toggle (persist via /settings)
/status-rotator status    # diagnostics: phase / line / packs / host seams / recent errors
```

Registered through dsh-commands; the mediated host surface (`tuiPluginHost.registerCommand`) is preferred when present so ownership and authorization checks apply.

## Advanced config

Add keys to the plugin row in the profile patch:

```yaml
- id: status-rotator
  config:
    intervalMs: 8000
    enabledPacks: [deepseek, coding, daily]   # omitted = default 10; null = all; [] = core only
    activePreset: night
    presets:
      - id: night
        name: Night
        phrases:
          zh:
            thinking: ["夜深了，还在盘…"]
            running: ["正在深夜档营业…"]
    schedule:
      - preset: night
        days: [1, 2, 3, 4, 5]     # ISO weekday, 1 = Monday; omitted = every day
        from: "22:00"
        to: "06:00"               # wraps midnight
    bankPath: null                # null/omitted = ~/.dsh-tui/status-rotator/bank.json
```

- **Packs**: 14 built-in packs (1362 entries, default 10 enabled = 945), ported verbatim from the web plugin;
- **Conditions / weights / rarity**: entries accept `{ text, weight, when, rarity }`; `when` supports `tool` / `retry` / `pending` / `phase` / `hour` / `firstTurn`, and matching conditionals win the draw;
- **Placeholders**: `{elapsed}` `{phase}` `{phaseLabel}` `{model}` `{provider}` `{tps}` `{pending}` `{tools}` `{running}` `{retry}` `{retryMax}` `{locale}` `{date}` `{time}`.

### External bank (hot reload)

Put an override-only JSON at `~/.dsh-tui/status-rotator/bank.json` (or point `DSH_TUI_STATUS_ROTATOR_BANK` / `bankPath` at a path):

```json
{ "packs": [{ "id": "china-ai", "phrases": { "zh": { "thinking": ["正在飞唐杰马…"] } } }] }
```

- Same-id packs replace the built-in pack wholesale; new ids append; `phrases` overrides the core bank; only `packs` / `phrases` / `enabledPacks` are read;
- Changes are picked up within ~2s, no restart;
- A corrupt file keeps the last good bank and reports the error in `/status-rotator status`; deleting the file falls back to the built-in bank.

### Extending from another plugin

The plugin provides `ctx.statusRotator` (ported from the web original):

```js
export const inject = ['statusRotator']

export function apply(ctx) {
  const api = ctx.get('statusRotator', false)
  if (!api) return
  ctx.effect(() => api.registerPack({ id: 'my-pack', label: { en: 'My pack' }, phrases: { en: { running: ['working for you…'] } } }))
  ctx.effect(() => api.registerPlaceholder('myState', () => '3 items'))
  ctx.effect(() => api.registerPhraseProvider(site => site.phase === 'long' ? [{ text: 'third-party conditional…', when: { phase: 'long' } }] : []))
}
```

Duplicate ids, reserved placeholder names and non-function providers **throw at registration** (explicit failure, never a silent no-op); registered content is never persisted and disappears on unload.

## Differences from the web original

| Web capability | This port | Why |
| --- | --- | --- |
| Phase rotation (thinking / running / long) | Ported | Driven by the host `sessionProjections` `workingActivity` view (the same source the TUI status line reads); phase changes swap immediately |
| Runtime data source | Adapted | Web original used DOM/host event windows; the TUI port consumes the host projection registry (deferred registration via `ctx.inject`, because plugin rows activate concurrently with the host extension rows) |
| Typewriter, weighted random, shuffle bag | Ported | View-local animation, per language+phase bags |
| Packs, dedupe, conditions, rarity | Ported | 14 packs / 1362 entries verbatim |
| Template placeholders | Mostly ported | `{pending}` only counts approvals (question panels are not observable from session events in dsh-TUI); `{model}`/`{provider}` render `—` when the TUI host does not expose them |
| Presets + weekday schedule | Ported | Configured in the plugin row |
| External hot-reload bank | Ported | Path moved to `~/.dsh-tui/status-rotator/bank.json` |
| Day/night dual gradient with auto switch | Adapted | dsh-TUI does not expose the active theme name to rich status views; default is a theme-key palette that follows light/dark, with explicit day/night palettes available |
| CSS fonts/glow/breathe/glitch, per-char CSS gradients | Adapted | Terminal per-cell colors and host fonts only; no CSS injection |
| Browser tab title rotation | N/A | No browser tabs |
| Danmaku, whale-tail animation, appearance theme gallery | N/A | No corresponding layer in the terminal status row |
| HTML settings page, HTTP + SSE config route | Adapted | Native `/settings` section and profile config instead; no HTTP port |
| `labelSource: host` | Ported | Steps aside |
| Third-party `ctx.statusRotator` API | Ported | Packs / placeholders / providers |

## Troubleshooting

Run `/status-rotator status`:

```text
status-rotator on lang=zh phase=none ; view=on set=on settings=on cmd=on ;
sessions=1 proj=on/4 active=idle events=22/2 frames=4 packs=10 preset=none ; line=- errors=none

(The host renders a command result as one ~200-cell line; the text above wraps for readability. `view/set/settings/cmd` report the four seams; `proj=on/N` the host projection source and folded changes; `events` the received session/agent events; `frames` published status frames.)
```

- **No line at all**: check `enabled=on`, `labelSource=phrases`, and that a turn is actually running (the plugin renders nothing when idle);
- **`view=off`**: the host refused rich status views; the plugin falls back to plain `tuiStatus.set` text (no typewriter/gradient) and says so under `errors`;
- **`line: none` with `bank.empty`**: every pack may be disabled, or the external bank overrode everything into an empty set;
- **No "Status rotator" page in settings**: the host lacks the `tuiSettingsSections` seam (diagnostic `host.missing-settingsSections`); use the row config instead;
- **No line under the Claude / Codex backends**: the phase engine consumes the DSH session projection; non-DSH kernel backends do not produce a `workingActivity` projection, so the plugin stays hidden instead of guessing. That is a host-backend difference, not a rotation failure.

### Debug logging

When "is it there or not" is not enough, enable the plugin debug log (stderr / explicit file only, never stdout):

```sh
export DSH_TUI_STATUS_ROTATOR_DEBUG=1
# optional: stderr interleaves with the TUI raw screen; a file is easier to read
export DSH_TUI_STATUS_ROTATOR_DEBUG_FILE=/tmp/sr-debug.log
```

It records seam registration, projection changes, session event types and every published frame (visibility/phase/text). See [docs/real-tty-replay.md](./docs/real-tty-replay.md) for a captured replay.

## Development and verification

```sh
npm install
npm run build          # tsc -> lib/types
npm test               # build + node --test test/
npm run check:manifest # offline dsh-plugin.json shape check
npm run check:bank     # pack counts / duplicates / control chars audit
npm run verify         # build + manifest + bank + all tests
npm run pack:verify    # npm pack content check
```

Real-host replay (headless assertions are not enough):

```sh
dsh plugin --profile dsh-tui add file:/absolute/path/to/dsh-tui-status-rotator
dsh --profile dsh-tui          # run a turn, watch the rotating line above the prompt
/status-rotator status         # confirm seams and bank
```

This port has been replayed on a real dsh-TUI 0.16.1 TTY (load, deferred seam
registration, per-frame rendering, /settings write-back, hide on turn end):
see [docs/real-tty-replay.md](./docs/real-tty-replay.md). Verification scope
and headless limits: [docs/verification.md](./docs/verification.md).

## Uninstall and data

- `disable`: deactivates the row; config and data stay;
- `remove`: removes the package and its row, **does not delete** `~/.dsh-tui/status-rotator/` user data; the report only states what the host actually revoked;
- Runtime resources (timers, file watcher, status view, settings section, command, provided service) are cordis effects and are released on unload.

## License and credits

- Phrase bank and behavior spec ported from [01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator) (MIT); phrase copyright belongs to the original authors and contributors;
- Host seams and design from [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) (MIT);
- This plugin is MIT licensed, see [LICENSE](./LICENSE).
