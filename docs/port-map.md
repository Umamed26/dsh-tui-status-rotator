# Port map — dsh-status-rotator (web) → dsh-tui-status-rotator (TUI)

Behavioral inventory of the web plugin and where each behavior landed in this
package. The rule of thumb: **phrase semantics are ported exactly, presentation
is re-seated onto dsh-TUI's native seams, and anything that only makes sense in
a browser is declared NOT-APPLICABLE with the environment reason instead of
being emulated badly.**

Provenance (read-only sources this map was derived from):

| Source | Version / commit | Role |
| --- | --- | --- |
| [dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator) | `0.37.0`, `bf980a6d6c9dd1fce87cb9b1611cf5d42f5c10e1` (2026-10-19) | feature semantics, `README_ZH.md`, `config.example.json` (14 packs / 1362 entries), `lib/client.js`, `lib/index.js` |
| [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | `@deepseek-harness-tui/dsh-tui 0.16.1`, `3ffbf246…` (2026-10-22) | host seams 6 (settings) and 11 (status line), command mediation, `~/.dsh-tui` data-directory convention |
| This package | `0.1.0` | TUI port |

Legend: **PORTED** = same user-visible behavior, implemented on the host seam;
**ADAPTED** = same intent, different mechanism, documented below; **N/A** =
cannot exist in a terminal TUI, environment reason given.

## 1. Presentation and lifecycle

| Feature | Web original | TUI port | Status |
| --- | --- | --- | --- |
| Rotating status copy | Rewrites the host chat status label via DOM (`role="status"` / `button[data-turn-process]`) | Registers a rich status view with `tuiStatus.registerView` (seam 11): key `status-rotator`, `maxRows: 1`; component receives `{React, ui}` and renders one line above the prompt | **ADAPTED** — no DOM, and the host owns the layout |
| Plain-text fallback | n/a (DOM always available) | If rich views are unavailable, falls back to `tuiStatus.set('status-rotator', text)`; a diagnostic states the degradation (no typewriter/gradient) | **ADAPTED** (new degradation path) |
| Phase awareness | Detects the host clock in the status DOM: no clock = `thinking`, clock under `longAfterMs` = `running`, over = `long`; hard-coded 15 s thinking boundary | Derives the phase from cordis `session/event` + `agent/status` (turn start, first token, elapsed), pure clock-injected `phaseOf`; boundaries are config: `thinkingMs` (new key, defaults to the original 15 s) and `longAfterMs` | **PORTED** (source of truth moves from DOM to session events) |
| Immediate phase switch | New phrase immediately on phase change | Same: the controller ticks every 500 ms and redraws on phase change | **PORTED** |
| Typewriter reveal | Per-character reveal every `typeSpeedMs` | Per-grapheme reveal (`Intl.Segmenter`), `typeSpeedMs` config; 0 = instant | **PORTED** |
| Rotation cadence | `intervalMs` | `intervalMs`, clamped 500 ms…10 min | **PORTED** |
| Rainbow gradient | CSS `background-clip: text` gradient, day/night palettes, `auto` follows theme, `rtl`/`ltr`, seconds/cycle | Per-cell palette sweep in the status view (`gradientColors()` returns one color per grapheme); `theme` mode uses host theme color keys (follows light/dark), `day`/`night` force explicit palettes; same direction and speed semantics | **ADAPTED** — terminal cells cannot interpolate colors, so the sweep steps through the palette |
| Font weight / font family / font size / glow / CSS animation / spinner | CSS styling of the injected span | Host theme and terminal font own all typography; the view only chooses text colors from the host palette | **N/A** — no CSS in a TUI, and a status line must not fight the host theme |
| Whale tail animation | Replaces/animates the host's whale-tail icon frames | Not rendered by plugins: the TUI host owns its icons and exposes no injection seam for them | **N/A** — no plugin-renderable host icon slot |
| Danmaku (scrolling/top/bottom) | Absolutely-positioned DOM overlay across the chat page, hover/click interactions, z-index, opacity, mask pause | No overlay layer exists in a terminal, and full-width movement would flicker and steal attention — explicitly ruled out by the port requirements ("不闪不抢焦点") | **N/A** — no DOM/overlay layer |
| Browser tab title rotation | Rewrites `document.title` with templates, ownership rules to avoid fighting other plugins | Terminal host owns the window title; no plugin seam, and the TUI is often inside a multiplexer that shares the title | **N/A** — no browser tab |
| HTML settings page (4 tabs, free-form phrase editor) | Injected React settings page with textareas, pack toggles, preset/schedule editors, PUT to server | Declarative settings section via `tuiSettingsSections.register` (seam 6) with 15 editable fields; advanced array-shaped keys (`packs`, `presets`, `schedule`) are profile-patch / external-bank territory because declarative field kinds can only edit scalars/selects | **ADAPTED** |
| HTTP config route + SSE push + ETag/If-Match | Node half serves `GET/PUT /plugins/dsh-status-rotator/config.json` + SSE change channel; browser polls or subscribes | No HTTP surface in the TUI plugin. Live config edits arrive through the host settings service (`loader/volatile-update`); bank edits hot-reload from a local file (below) | **N/A** — no web server/client pair; the host already owns settings persistence |
| localStorage override layers | `localStorage` full config / per-locale text overrides beat the file | No browser storage. Layers become: built-in data → external bank file → profile config (`enabledPacks` etc.) | **N/A** — no browser storage |
| Clean install/uninstall | Remove the `cordis.patch.yml` row, restart `dsh web` | Same row removal; unload disposers stop the rotation timer (unref'd), unwatch the bank file, unregister the view/settings section/command/service. The loader never writes to `~/.dsh-tui` (read-only bank file) | **PORTED** |
| Visible errors, never silent no-ops | Settings page marks errors, `status().failures`, console warnings | Every degradation is a diagnostic: missing seam, config clamp, dropped bank entry, corrupt bank file. Surfaced in host logs and `/status-rotator status` | **PORTED** (mechanism adapted: diagnostics sink instead of HTML/console) |

## 2. Phrase semantics (the part that must match exactly)

| Feature | Web original | TUI port | Status |
| --- | --- | --- | --- |
| Bank format | `{ config, phrases: {zh,en}, packs[], enabledPacks[] }`; entries are strings or `{text,weight,when,rarity}` | Same shapes (`BankDoc`, `PackDoc`, `PhraseEntry` in `src/types.ts`); 14 built-in packs extracted verbatim | **PORTED** |
| Built-in corpus | 1362 entries in 14 packs (zh 746 / en 616); core `phrases` table empty; 10 packs enabled by default (945 entries, zh 505 / en 440) | Same 14 packs, same texts/weights/order/labels, same default selection; pinned by SHA-256 `d6bbe22d…ae25` | **PORTED** |
| Pack merge order | enabled packs merged in array order | same | **PORTED** |
| Text de-duplication | per language + phase, first occurrence wins, its weight is kept | same (`mergeBank`) | **PORTED** |
| `enabledPacks` | undefined/`null` = all, `[]` = core only, unknown ids silently ignored | same, plus an explicit `bank.unknown-pack` warning so a typo is visible | **PORTED + hardened** |
| Weighted random | weight 1…1000, illegal = 1; `weightedRandom: false` = uniform | same, in the selection engine | **PORTED** |
| Anti-repeat shuffle bag | per language+phase bag, `antiRepeat.recentLimit` 0…50, `persist` via localStorage | bag + `antiRepeatRecentLimit`; `persist` has no equivalent (state is process-local, cleared on unload) | **PORTED** (`persist` **N/A** — no browser storage) |
| `when` conditions | tool / retry / pending / phase / hour / firstTurn, AND-ed; conditional hits take priority, unconditional fallback; no match = no empty line | same in the engine; `phase: "idle"` is accepted for input compatibility but a TUI live phase is never `idle`, so it never matches (same effective behavior: an idle-only phrase never shows during a turn) | **PORTED** (`idle` = **ADAPTED**, documented) |
| `rarity` | (0,1]; only that fraction of draws lets the entry join; invalid = treated as always | same | **PORTED** |
| Placeholders | `{elapsed} {phase} {phaseLabel} {model} {provider} {tps} {pending} {tools} {running} {retry} {retryMax} {retryProvider} {retryCode} {retryStarted} {detail} {locale} {date} {time}` | The first 15 are ported (`{detail}` renders the original `⟳ n/max` badge). `{retryProvider}`, `{retryCode}`, `{retryStarted}` need the host retry-observation events, which are not in `LiveContext` — unknown placeholders are left verbatim and reported as diagnostics | **PORTED** (3 placeholders **N/A** in v1) |
| Presets | named phrase snapshots + per-preset `config` overrides; selected by `activePreset` or `schedule` | `config.presets` keeps the phrase/pack snapshot; per-preset `config` overlay is not ported (the TUI config is host-settings-scoped). A preset replaces the core phrase table **per language** (missing language falls back to the global core), and may carry its own `packs` / `enabledPacks` | **ADAPTED** |
| Schedule | weekday 0–6 (Sun–Sat) + local `HH:MM` window, wraps midnight; first match wins | `config.schedule`; weekdays are ISO 1–7 (Mon–Sun) mapped once from `Date.getDay()`; same window rules | **ADAPTED** (weekday numbering) |
| Phrase language | follows DSH UI language, unknown → zh | `language: auto` resolves `DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → OS locale → en; `zh`/`en` force | **PORTED** |
| `labelSource` | `phrases` = rotate bank; `host` = leave/restore host original text | same: `phrases` renders our line; `host` keeps the host line untouched | **PORTED** |
| Extension API `ctx.statusRotator` | `registerPack`, `registerPlaceholder`, `registerPhraseProvider`, `sendDanmaku`; explicit errors on collision; `status()` reports failures | `ctx.provide('statusRotator')` with the first three (v1); `sendDanmaku` has no TUI meaning; `status()` reports host seam flags, engine snapshot, included packs, diagnostics | **PORTED** (`sendDanmaku` **N/A**) |
| Bank auto-update from GitHub/jsDelivr every 6 h | node half fetches upstream `config.example.json`, caches, keeps last good | Not ported: plugins should not do background network fetches inside a terminal host, and the port requirement is an offline, inspectable local bank. Updating the bank is an explicit file operation | **N/A** (environment/policy reason) |
| External hot-reload bank file | `$DSH_HOME/status-rotator/phrases.json`, env `DSH_STATUS_ROTATOR_BANK`; only `packs`/`phrases`; last good kept on corruption | `~/.dsh-tui/status-rotator/bank.json`, env `DSH_TUI_STATUS_ROTATOR_BANK`, config `bankPath`; `packs`/`phrases`/`enabledPacks` accepted; last good kept, error exposed, 2 s poll, deletion notifies fallback; a same-id pack **replaces** the built-in pack wholesale | **ADAPTED** (see docs/bank.md) |

## 3. Configuration key map

Every key of the original `config.example.json` and its TUI counterpart. The
TUI config lives in the cordis profile patch row and in the host settings
section; there is no `config` wrapper key.

### 3.1 Runtime / behavior

| Original key | Default | TUI counterpart | Status |
| --- | --- | --- | --- |
| `intervalMs` | `10000` | `intervalMs` (editable, 500…600000) | PORTED |
| `typeSpeedMs` | `30` | `typeSpeedMs` (editable, 0…2000; 0 = instant) | PORTED |
| `longAfterMs` | `60000` | `longAfterMs` (editable, 0…3600000, clamped ≥ `thinkingMs`) | PORTED |
| — | (hard-coded 15 s thinking window) | `thinkingMs` (editable, new key, default 15000) | ADAPTED |
| `reloadIntervalMs` | `15000` | — no polling: settings changes arrive via `loader/volatile-update`; bank changes via the 2 s file poll | N/A |
| `liveTickMs` | `1000` | — controller tick is internal (500 ms); live placeholders refresh on it | N/A |
| `labelSource` | `"phrases"` | `labelSource: "phrases" \| "host"` (editable select) | PORTED |
| `weightedRandom` | `true` | `weightedRandom` (editable) | PORTED |
| `antiRepeat.recentLimit` | `3` | `antiRepeatRecentLimit` (editable, 0…50) | PORTED |
| `antiRepeat.persist` | `false` | — no browser storage; engine memory is process-local | N/A |
| `debug` | `false` | — diagnostics are always collected and shown by `/status-rotator status`; no debug switch | ADAPTED |
| — | — | `enabled` (new: profile row switch) | ADAPTED |
| — | — | `language: "auto" \| "zh" \| "en"` (new; original followed UI language implicitly) | ADAPTED |

### 3.2 Appearance

| Original key | Default | TUI counterpart | Status |
| --- | --- | --- | --- |
| `gradient.enabled` | `true` | `gradientEnabled` (editable) | PORTED |
| `gradient.mode` | `"auto"` | `gradientMode: "theme" \| "day" \| "night"` (`auto` → `theme`, follows host theme keys) | ADAPTED |
| `gradient.direction` | `"rtl"` | `gradientDirection: "rtl" \| "ltr"` | PORTED |
| `gradient.colors` | 7-color night palette | `gradientColors` (comma-separated string in the settings form) | PORTED |
| `gradient.dayColors` | 7-color day palette | `gradientDayColors` | PORTED |
| `gradient.speed` | `4` (s/cycle) | `gradientSpeedSec` (1…60) | PORTED |
| `fontWeight` | `"inherit"` | — host theme owns typography | N/A |
| `appearance.fontFamily` / `fontSize` / `glow` / `glowColor` / `animation` / `spinner` | various "do nothing" defaults | — no CSS, no per-plugin text styling in the status line | N/A |
| `details.enabled` / `details.badge` (`⟳ {retry}/{max}`) | enabled | The `{detail}` placeholder renders the same `⟳ n/max` badge; there is no separate badge-template key (the other retry-observation placeholders are not ported either) | ADAPTED |
| `title.enabled` / `templates` / `idleTemplate` / `intervalMs` | off | — no browser tab title | N/A |
| `whaleTail` / `whaleTailMotion.` (enabled, mode, animation, toolSwitchEnabled, toolSwitchChance, fixedSpeed, randomActions, officialRecommendedSpeed, tpsTiers) | off | — host owns its icons; no render seam | N/A |
| `danmaku.*` — enabled, pauseBehindMask, intervalMs, speedMs, fontSizeMin/Max, rainbow, colors, color, opacity, maxCount, zIndex, scope, marginTop/Bottom, mode, `types.` (scroll/top/bottom × enabled/weight), `fixed.` (fontSize, color, shadow, marginTop/Bottom, gap, durationMs, maxCount, zIndex, reserveBands, anchorBottomToHost, overflow), hoverPause, clickCopy, phaseColors, adaptDensity, avoidPointer | on by default in the web plugin | — no DOM overlay; ruled out by the port requirements | N/A |

### 3.3 Bank / automation (top level, next to `config`)

| Original key | Default | TUI counterpart | Status |
| --- | --- | --- | --- |
| `phrases` | `{}` (empty; copy lives in packs) | `BUILTIN_CORE_PHRASES` (`{}`), overridable by the external bank `phrases` | PORTED |
| `packs` | 14 built-in packs | `BUILTIN_PACKS` (verbatim), extendable/replaceable by the external bank `packs` (same id replaces) | PORTED |
| `enabledPacks` | 10 ids | `DEFAULT_ENABLED_PACKS`; overridden by config `enabledPacks` (advanced key) and then by the external bank's `enabledPacks` | PORTED (precedence adapted) |
| `presets` | none | `config.presets` (advanced profile-patch key; not in the settings form) | ADAPTED |
| `activePreset` | `null` | `config.activePreset` | ADAPTED |
| `schedule` | none | `config.schedule` (ISO weekdays) | ADAPTED |
| — | — | `bankPath` (new: external bank file override) | ADAPTED |

Precedence for `enabledPacks` in the TUI port (highest first): external bank
`enabledPacks` → profile config `enabledPacks` (`undefined` = built-in default,
`null` = all packs, `[]` = core only) → built-in default id list.

## 4. Intentional behavior differences (read before reviewing)

1. **`enabledPacks` typos are reported.** The web plugin ignores unknown ids
   silently; the TUI port emits `bank.unknown-pack`. The selected bank is the
   same, but a typo is now visible instead of "half the bank disappeared".
2. **Invalid `when` drops the entry.** The web client silently turned a
   malformed condition into an unconditional phrase; the port drops the entry
   with a warning so a phrase never appears in the wrong state by accident.
3. **Invalid text is dropped.** The port rejects blank text, control
   characters (including tab/newline — a multi-line phrase would break the
   one-line status view) and copy longer than 200 code points. The web plugin
   accepted any non-empty string; 200 is the original submission limit and the
   built-in corpus max is 66 code points.
4. **External bank pack replacement is wholesale.** To override a built-in
   pack from `bank.json`, supply that pack completely (the whole pack object is
   replaced by id); to add copy, use a new pack id. The web original layered
   packs recursively inside the document merge; the TUI keeps the simpler,
   predictable "same id replaces" rule (checked by the acceptance checklist).
5. **Deleting the bank file notifies the runtime.** `onReload({})` makes the
   external layer fall back to the built-in bank instead of leaving stale copy
   in memory. The web plugin's next cache read achieved the same by returning
   `null`.
6. **No preset `config` overlay.** Presets swap phrases/packs/pack selection
   only; behavior keys stay global (host settings). This is a consequence of
   persisting config in the host settings service.
7. **No auto-update / no network.** The bank is local and inspectable; upstream
   copy can be synced with a normal file write (which is then hot-reloaded).

## 5. Acceptance checklist

Build and tests (all from the project root):

| # | Command | Expected |
| --- | --- | --- |
| 1 | `npm run build` | exits 0; `lib/types/index.js`, `lib/types/bank/index.js`, `lib/types/bank/external.js` exist |
| 2 | `node --test "test/bank/*.test.ts"` (or plain `node --test` after build) | 64 bank tests pass, 0 fail |
| 3 | `node -e "import('./lib/types/bank/data.js').then(m=>console.log(m.BUILTIN_PACKS.length, m.DEFAULT_ENABLED_PACKS.length, m.BUILTIN_BANK_SHA256))"` | `14 10 d6bbe22db130228eae4683b7bda6db10ebc3eb97369e6f6879eee6d97989ae25` |
| 4 | `node --test test/bank/data.test.ts` | 1362 total, zh 746 / en 616, default-enabled 945 (zh 505 / en 440), per-pack/per-phase table matches |
| 5 | `node --test test/bank/normalize.test.ts` | all 14 packs merge with zero warnings; default selection merges to 945; dedupe/enabledPacks/invalid-entry cases pass |
| 6 | `grep -rn "FIXME" src/bank/normalize.ts src/bank/external.ts test/bank` | no output (phrase copy under `src/bank/packs/` is data, not source) |

Behavioral checks (need a TUI host — manual replay):

| # | Step | Expected |
| --- | --- | --- |
| 7 | Start the TUI with the plugin row; start a turn | one line above the prompt rotates every `intervalMs`, typewriter reveal, optional gradient; blinking/CPU usage must stay minimal (text only, no timers per frame) |
| 8 | Open `/settings` → plugin section | 15 editable fields; changing `intervalMs` / `gradientEnabled` applies live without restart |
| 9 | `/status-rotator status` | `enabled=on`, current line, included packs (10 by default), host seam flags, `errors: none` |
| 10 | `/status-rotator next` / `on` / `off` | immediate change; `off` hides the line until turned on (runtime override only) |
| 11 | Write `~/.dsh-tui/status-rotator/bank.json` with a new pack + `enabledPacks: [that-id]` while running | within ~2 s the line draws from the external pack; `/status-rotator status` shows it in packs |
| 12 | Corrupt that file (`not json`) | line keeps the last good copy; `/status-rotator status` shows `bank.external-parse`; host log has the same diagnostic |
| 13 | Delete the file | line falls back to the built-in packs within ~2 s; no error remains |
| 14 | Uninstall (remove profile row) / restart | line disappears; no leftover timer or file watcher; `~/.dsh-tui/status-rotator/` is never created or modified by the plugin |
| 15 | Check the host's `/plugin` diagnostics | no cleanup-failed effect records for this plugin |

## 6. File map of the port

| Path | Contents |
| --- | --- |
| `src/bank/data.ts` | `BUILTIN_PACKS` (14), `DEFAULT_ENABLED_PACKS`, `BUILTIN_CORE_PHRASES`, `BUILTIN_BANK_DOC`, `BUILTIN_BANK_SHA256` (deep-frozen) |
| `src/bank/packs/*.ts` | one module per built-in pack, copy verbatim from `config.example.json` |
| `src/bank/normalize.ts` | validation (`normalizePhraseInput`, `normalizePhraseGroups`, `normalizePackInput`, `normalizeBankDoc`) and merge (`mergePhaseEntries`, `mergeBank`) |
| `src/bank/external.ts` | `createExternalBank()` hot-reload loader + path resolution helpers |
| `src/bank/index.ts` | public entry point re-exporting the above |
| `test/bank/data.test.ts` | corpus integrity: counts, SHA-256, weights, freezing |
| `test/bank/normalize.test.ts` | normalization/merge semantics and warnings |
| `test/bank/external.test.ts` | file loader: missing/corrupt/reload/delete/path precedence/watcher cleanup |
| `docs/bank.md` | bank data model, merge rules, external file contract, diagnostics codes |

The phrase **selection** engine (shuffle bag, weighted draw, `when`/rarity
matching) lives in `src/engine/` (owned by the engine task); the **runtime**
(controller, preset/schedule activation, provider merging) lives in
`src/runtime/`. This map only claims the bank/persistence half of the port;
presentation seams are covered by `docs/integration.md`.