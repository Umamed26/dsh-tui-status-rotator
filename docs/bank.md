# Bank: data, normalization, merge and the external hot-reload file

This document is the contract for the phrase-bank half of the port: the 14
built-in packs, how untrusted bank JSON is validated, how packs merge into the
single bank the selection engine consumes, and how the optional external
`~/.dsh-tui/status-rotator/bank.json` file is watched and layered on top.

Related documents:

- `docs/port-map.md` — behavior inventory and the original→TUI config map.
- `docs/engine.md` — selection engine (shuffle bag, weighted draw, `when` / rarity).
- `docs/integration.md` — host seam wiring.
- Source: `src/bank/` (this module), `src/runtime/bank-sources.ts` and
  `src/runtime/controller.ts` (consumers).

## 1. Files

| Path | Contents |
| --- | --- |
| `src/bank/data.ts` | `BUILTIN_PACKS`, `DEFAULT_ENABLED_PACKS`, `BUILTIN_CORE_PHRASES`, `BUILTIN_BANK_DOC`, `BUILTIN_BANK_SHA256` — all deep-frozen |
| `src/bank/packs/*.ts` | one module per built-in pack, copy extracted verbatim from dsh-status-rotator `config.example.json` |
| `src/bank/normalize.ts` | validation + merge (this document's main subject) |
| `src/bank/external.ts` | `createExternalBank()` loader: path resolution, mtime+size fast path, 2 s poll, last-good retention |
| `src/bank/index.ts` | public entry point (`export *` from the three modules above) |
| `test/bank/data.test.ts` | corpus integrity (counts, SHA-256, weights, freezing) |
| `test/bank/normalize.test.ts` | validation/merge semantics and warnings |
| `test/bank/external.test.ts` | loader behavior against real temp files |

## 2. Built-in corpus

The web plugin ships an **empty core `phrases` table** — every default phrase
lives in one of 14 theme packs. The port copies that data verbatim: same texts,
same order, same weights, same zh/en split, same pack ids and labels.

| Pack | zh | en | Total | Default |
| --- | --- | --- | --- | --- |
| `deepseek` | 107 | 111 | 218 | on |
| `coding` | 87 | 81 | 168 | on |
| `daily` | 77 | 64 | 141 | on |
| `internet-memes` | 57 | 34 | 91 | on |
| `sysadmin` | 41 | 38 | 79 | on |
| `slacking` | 40 | 33 | 73 | on |
| `math-physics` | 35 | 22 | 57 | on |
| `western-ai` | 20 | 22 | 42 | on |
| `reverse-proxy` | 19 | 21 | 40 | on |
| `china-ai` | 22 | 14 | 36 | on |
| `community` | 66 | 0 | 66 | off |
| `ads` | 3 | 3 | 6 | off |
| `star-ask` | 11 | 12 | 23 | off |
| `star-route` | 161 | 161 | 322 | off |
| **total** | **746** | **616** | **1362** | **on 945 / off 417** |

- `DEFAULT_ENABLED_PACKS` = the first 10 ids, in the table/array order.
- 5 entries are weighted demos (`{ text, weight }`); all other 1357 are plain
  strings. The built-in corpus contains **no** `when` or `rarity` entries —
  those are exercised by the external file and the engine tests.
- The whole document (`{phrases, packs, enabledPacks}`) is pinned by
  `BUILTIN_BANK_SHA256 = "d6bbe22db130228eae4683b7bda6db10ebc3eb97369e6f6879eee6d97989ae25"`
  (SHA-256 of its canonical `JSON.stringify`). A reword/reorder/dropped entry
  fails `test/bank/data.test.ts`.
- The arrays and every nested object are frozen; a consumer that tries to
  mutate shipped data fails loudly instead of corrupting the bank silently.
- Attribution: the phrase copy and pack ids/labels come from
  [dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator) (MIT); the
  port keeps its license and does not reword or reformat the copy.

## 3. Normalization rules (untrusted input)

Every entry point handles untrusted JSON without throwing. Invalid content is
dropped (or degraded, where noted) and reported as a `BankWarning`
`{ code, message }`; the message always starts with the source path, e.g.
`packs["my-pack"].zh.thinking[3].text: …`.

### 3.1 Phrase entry (`string | { text, weight?, when?, rarity? }`)

| Field | Rule | On violation |
| --- | --- | --- |
| `text` | non-empty string, not whitespace-only, no C0/C1 control characters (tab/newline/CR included), ≤ 200 Unicode **code points** | entry dropped |
| `weight` | finite number > 0; values above 1000 clamp to 1000 | illegal → **1** (original README: "非法值按 1 处理"), warning; above cap → 1000, warning. Fractional weights are preserved |
| `rarity` | number in (0, 1] (1 = participates in every draw) | field dropped with a warning; the entry stays and behaves as rarity 1 |
| `when` | object; unknown keys/values rejected (see below) | entry dropped with a warning — a typo must not silently make a conditional phrase unconditional |
| unknown sibling fields | ignored | warning `bank.unknown-field`, entry kept |

Copied strings are never trimmed or normalized: what is in the file is what the
status line shows.

### 3.2 `when` conditions

| Key | Accepted value | Invalid value |
| --- | --- | --- |
| `tool` | non-empty string (≤ 64 chars), array of those (empty items filtered), or `"*"` | entry dropped |
| `retry` / `firstTurn` | boolean | entry dropped |
| `pending` | boolean, or finite number ≥ 0 (floored: `2.9` → `2`) | entry dropped |
| `phase` | `"thinking" \| "running" \| "long" \| "idle"`, or an array of those (invalid items filtered) | entry dropped |
| `hour` | `[startHour, endHour]` integers 0…23 (inclusive start, exclusive end, wraps midnight; equal bounds = all day) | entry dropped |
| unknown key | — | entry dropped |
| `null` | treated as "no condition" (unconditional entry) | — |
| empty object `{}` | treated as "no condition" (unconditional entry) | warning `bank.when-empty` |

`when.phase: "idle"` is accepted for compatibility with the web original.
A dsh-TUI live context only has `thinking` / `running` / `long`, so an
`idle` condition never matches — the same effective behavior as the original
during a turn. This is the one place where `src/types.ts`
(`WhenCondition.phase`) is narrower than the input format; the value is
preserved at runtime through a documented cast rather than silently rewritten.

### 3.3 Phrase groups

Accepted shapes (original `normalizeGroups` semantics):

- `{ thinking: [...], running: [...], long: [...] }` — missing groups are empty;
- a legacy **flat array** — treated as the `thinking` group;
- `undefined` — empty groups, no warning (absent key);
- anything else — empty groups + `bank.groups` warning.

Unknown phase keys and non-array groups are reported and ignored. The result
always has all three phase arrays.

### 3.4 Pack

| Field | Rule | On violation |
| --- | --- | --- |
| `id` | non-empty string, ≤ 64 chars, no control characters; ids are compared by exact text | pack dropped |
| `label` | string (shared by both languages) or `{ zh?, en? }` of non-empty strings | invalid language label dropped with warning; pack kept |
| `phrases` | `{ zh?, en? }` language table with phrase groups | missing/non-object → pack dropped; no usable phrase in any language → pack dropped (it would otherwise erase the built-in pack of the same id in the external layer) |

### 3.5 Bank document

Only `packs` / `phrases` / `enabledPacks` are accepted; every other key
(notably `config` and `schedule` from the web file) is ignored with a
`bank.unknown-field` warning.

- `phrases` accepts a `{ zh?, en? }` language table, or the original legacy
  form — a single group table/array shared by both languages.
- `packs` must be an array; invalid packs are dropped, duplicate ids keep the
  first pack (`bank.duplicate-pack`).
- `enabledPacks` accepts `null` or an array; non-string/empty entries are
  dropped with a warning (the web client silently degraded the whole list to
  `null` = all packs).
- The document is **valid** when it is a JSON object with at least one of the
  three keys. `{}` / `{ "config": … }` are invalid (`bank.doc-empty`) and
  the external loader keeps the last good document instead of accepting them.
  A document whose content all got dropped (e.g. `{ "packs": [{ "id": "x" }] }`)
  stays valid with warnings — explicit input, explicit degradation.

## 4. Merge rules

### 4.1 `mergeBank({ core?, packs?, enabledPacks?, extraCore? })`

Merge order (first occurrence of a text wins, and **keeps its weight**):

1. `core` phrase table (per language);
2. enabled packs, in the `packs` array order;
3. `extraCore` — runtime-only sources appended after every pack (third-party
   phrase providers merged by the controller).

Details:

- De-duplication is per **language + phase** (the same text may legitimately
  live in `thinking` and `running`, or in zh and en).
- `enabledPacks`: `undefined` / `null` = all packs; `[]` = core only;
  unknown ids are ignored with a `bank.unknown-pack` warning.
- `includedPacks` lists the ids that contributed at least one entry, in merge
  order. A pack whose entries were all duplicates is not listed.
- The result always has `zh` and `en` × `thinking` / `running` / `long`
  arrays (possibly empty) plus `warnings` (frozen array).
- Invalid pack/core content degrades exactly like section 3 above; the function
  never throws.

### 4.2 `mergePhaseEntries(base, extra, source?)`

Used by the runtime controller to append third-party provider phrases to one
already-merged phase list: extras are normalized, invalid ones are dropped and
de-duplicated by text against the base and each other; first occurrence keeps
its weight, so the caller controls priority by argument order (base first).
`source` is reserved for diagnostics (the function has no warning channel).

## 5. Assembling the effective bank (runtime layering)

`src/runtime/bank-sources.ts` builds the controller's sources from three
inputs — built-in data, the external document (or `null`) and the resolved
config:

1. **packs** = `BUILTIN_PACKS`, then the external document's packs: a pack
   with the same id **replaces the built-in pack wholesale**, a new id appends.
2. **core** = the external document's `phrases` table (the built-in core is
   empty, so this is the only core layer).
3. **enabledPacks** precedence (highest first):
   external document's `enabledPacks` → profile config `enabledPacks`
   (`undefined` = built-in `DEFAULT_ENABLED_PACKS`, `null` = all packs,
   `[]` = core only) → `DEFAULT_ENABLED_PACKS`.

### 5.1 Preset / schedule layering (runtime controller)

Presets are phrase snapshots, not bank layers appended to the pack chain. When
a preset is active (`config.activePreset` or a matching schedule rule):

- **core**: for each language, the preset's `phrases.<lang>` replaces the
  global core for that language; a missing language falls back to the global
  core;
- **packs**: `preset.packs ?? sources.packs` (undefined preset packs = keep
  the global pack list);
- **enabledPacks**: `preset.enabledPacks ?? sources.enabledPacks`;
- then normal merge rules apply (preset core → enabled packs).

The original plugin also carried per-preset `config` overrides; the TUI
ResolvedConfig shape has no preset config field (behavior keys are host
settings), so only phrases/packs/selection follow the preset. The sources are
merged through the same `mergeBank` call, so de-duplication and diagnostics
are identical.

### 5.2 Schedule rules

`config.schedule` entries are `{ preset, days?, from, to }` with ISO weekdays
`1…7` (Mon…Sun; mapped once from `Date.getDay()`; omitted = every day,
explicit empty list = never) and local `HH:MM` windows that may wrap midnight;
the first matching rule in array order wins, and leaving the window returns to
`config.activePreset`. Unknown preset ids are ignored with a warning. (The
original used JS weekdays `0…6` — this is the documented ADAPTED difference.)

## 6. External hot-reload bank file

### 6.1 Path precedence

| Priority | Source | Example |
| --- | --- | --- |
| 1 | profile config `bankPath` (a non-empty string) | `/home/me/bank.json` |
| 2 | env `DSH_TUI_STATUS_ROTATOR_BANK` | `DSH_TUI_STATUS_ROTATOR_BANK=~/bank.json` |
| 3 | default: data directory + `bank.json` | `~/.dsh-tui/status-rotator/bank.json` |

A leading `~` is expanded; relative paths resolve against the process working
directory (matching the web plugin's env-var behavior). The data-directory
default follows dsh-TUI's own convention (all preferences live under
`~/.dsh-tui`; see the host's `src/utils/paths.ts`). The plugin only ever
**reads** this file — it never creates the directory, writes the file, or
migrates it.

### 6.2 Accepted content

Same document rules as section 3.5: only `packs` / `phrases` /
`enabledPacks` are used, everything else (notably `config`) is ignored with
a warning. The document is a **layer**, not a full copy: only the keys you
write override something.

> ⚠️ **Same-id packs replace the whole built-in pack** (section 5, rule 1). To
> adjust one built-in phrase, supply the complete pack (all languages/phases
> you want to keep) under that id. To *add* copy, use a brand-new pack id and
> enable it via `enabledPacks` in the same file (or in the config).

Minimal examples (all example copy below is taken from the shipped corpus; a
real override writes your own text in the same shapes):

```json
// add a custom pack and enable only the core plus that pack
{
  "phrases": { "zh": { "thinking": ["正在进入深度摸鱼前摇…"] } },
  "packs": [
    { "id": "my-pack", "label": { "zh": "我的词库", "en": "My pack" },
      "phrases": { "zh": { "running": ["正在干完活偷偷写游戏…"] } } }
  ],
  "enabledPacks": ["my-pack"]
}
```

```json
// the complete-pack shape required for a same-id override; shown with the
// shipped "ads" copy - substitute your own text in exactly this shape
{
  "packs": [
    { "id": "ads", "label": { "zh": "广告", "en": "Ads" },
      "phrases": { "zh": { "running": ["正在优化提示词 github.com/WestFox-AwA/dsh-prompt-optimizer…"] },
                   "en": { "running": ["Optimizing the prompt github.com/WestFox-AwA/dsh-prompt-optimizer…"] } } }
  ]
}
```

### 6.3 Lifecycle and failure semantics

| Situation | Behavior |
| --- | --- |
| File missing at startup | External layer off: no callback, `status.loaded = false`, `status.error = null` — **not** an error |
| Valid file at startup | Loaded synchronously during `start()`; `onReload(doc)` called with the normalized document |
| File created/changed later | Detected by a 2 s poll (mtime nanoseconds + size fast path; content compared before accepting) then `onReload(doc)` |
| Corrupt JSON / not a bank document | **Last good document keeps serving**; `status.error` set, `status.ok = false`, `onReload` is *not* called; the same content is not re-parsed every 2 s (it waits for the next file change) |
| File becomes valid again | Reloads normally, error cleared |
| File deleted after a good load | `onReload({})` fires once so the runtime drops the external layer and falls back to the built-in bank; `status.loaded = false`, error cleared |
| Normalization warnings | Entries are dropped but the document is still accepted; every warning is forwarded to the diagnostic log |
| `onReload` callback throws | Caught and reported (`bank.external-callback`); loading continues |
| `stop()` | Removes the watcher (idempotent); status keeps its last snapshot |

`current()` always returns the last **normalized** document (invalid entries
already dropped, only the three accepted keys) or `null` when the external
layer is off.

### 6.4 `ExternalBankStatus`

| Field | Meaning |
| --- | --- |
| `ok` | last load attempt had no error (`loaded` may still be false because the file is simply missing) |
| `path` | absolute resolved path being watched |
| `loaded` | a document from this file is currently in effect |
| `error` | last load error message (parse/validation/read), `null` after success or when missing |
| `reloads` | number of accepted document changes since `start()` |
| `lastLoadedAt` | epoch ms of the last accepted load (`null` before the first) |

The runtime exposes these through the plugin's diagnostics (`/status-rotator
status` shows the newest diagnostics, including the external error).

## 7. Diagnostics codes

### 7.1 Normalization (`BankWarning.code`)

| Code | Meaning |
| --- | --- |
| `bank.text-type` / `bank.text-empty` / `bank.text-control` / `bank.text-too-long` | phrase text rejected (wrong type / blank / control characters / more than 200 code points) |
| `bank.weight` / `bank.weight-clamped` | illegal weight fell back to 1 / weight clamped to 1000 |
| `bank.rarity` | illegal rarity dropped from the entry |
| `bank.when` / `bank.when-key` / `bank.when-tool` / `bank.when-boolean` / `bank.when-pending` / `bank.when-phase` / `bank.when-hour` | malformed `when` rule (entry dropped) |
| `bank.when-empty` | empty `{}` condition treated as unconditional |
| `bank.entry` | entry unusable (bad type, or dropped because of its `when`) |
| `bank.unknown-field` | unknown object field ignored (entry/pack/document kept) |
| `bank.groups` / `bank.group` / `bank.phrases` | phrase-group table / group / languages malformed |
| `bank.pack` / `bank.pack-id` / `bank.pack-phrases` / `bank.pack-empty` / `bank.pack-label` / `bank.packs` | pack rejected or label degraded |
| `bank.duplicate-pack` | later pack with an already-seen id ignored |
| `bank.unknown-pack` | `enabledPacks` names an id no pack provides (ignored, warning only) |
| `bank.enabled-packs` | `enabledPacks` not an array, or invalid ids dropped |
| `bank.doc` / `bank.doc-empty` | external document not an object / has none of the accepted keys (invalid document) |
| `bank.core` / `bank.extra-core` | malformed core / runtime extra-source table |

### 7.2 External loader (forwarded to the runtime log)

| Code | Meaning |
| --- | --- |
| `bank.external-parse` | file is not valid JSON |
| `bank.external-invalid` | valid JSON but not a usable bank document |
| `bank.external-stat` / `bank.external-read` | filesystem error other than "missing" (last good kept) |
| `bank.external-watch` | unexpected error while loading from the watcher / starting the watch |
| `bank.external-callback` | the runtime `onReload` callback threw (isolated) |
| `bank.text-*` / `bank.pack-*` / … | normalization warnings from the accepted document (see 7.1) |

## 8. API reference (public exports)

```ts
// src/bank/index.ts re-exports all of:
//   data.ts
export const BUILTIN_PACKS: readonly PackDoc[]
export const DEFAULT_ENABLED_PACKS: readonly string[]
export const BUILTIN_CORE_PHRASES: NonNullable<BankDoc['phrases']>
export const BUILTIN_BANK_DOC: BankDoc
export const BUILTIN_BANK_SHA256: string

//   normalize.ts
export const MAX_PHRASE_CODE_POINTS: 200
export const MAX_PHRASE_WEIGHT: 1000
export const MAX_TOOL_NAME_LENGTH: 64
export const MAX_PACK_ID_LENGTH: 64
export function normalizePhraseInput(value: unknown): PhraseEntry | undefined
export function normalizePhraseGroups(input: unknown, source: string): { groups: PhaseGroups; warnings: readonly BankWarning[] }
export function normalizePackInput(input: unknown, source: string): { pack?: PackDoc; warnings: readonly BankWarning[] }
export function normalizeBankDoc(input: unknown, source?: string): { doc: BankDoc; valid: boolean; warnings: readonly BankWarning[] }
export function mergePhaseEntries(base: readonly PhraseEntry[], extra: readonly PhraseInput[], source?: string): readonly PhraseEntry[]
export function mergeBank(input: MergeBankInput): MergedBank

//   external.ts
export const EXTERNAL_BANK_ENV = 'DSH_TUI_STATUS_ROTATOR_BANK'
export const EXTERNAL_BANK_FILE = 'bank.json'
export const EXTERNAL_BANK_POLL_MS = 2000
export function defaultExternalBankDir(env?: NodeJS.ProcessEnv): string
export function expandBankPath(path: string, env?: NodeJS.ProcessEnv): string
export function resolveExternalBankPath(options?: Pick<ExternalBankOptions, 'dir' | 'file' | 'env'>): string
export function createExternalBank(options: ExternalBankOptions): ExternalBankHandle
```

`MergeBankInput` = `{ core?: BankDoc['phrases']; packs?: readonly PackDoc[]; enabledPacks?: readonly string[] | null; extraCore?: Readonly<Record<Lang, Partial<Record<Phase, readonly PhraseInput[]>>>> }`.
`ExternalBankHandle` = `{ start(); stop(); status(): ExternalBankStatus; current(): BankDoc | null; reloadNow() }`.

The runtime imports `BUILTIN_PACKS` / `DEFAULT_ENABLED_PACKS` from
`src/bank/index.ts` and `createExternalBank` from
`src/bank/external.ts`; the controller imports `mergeBank` /
`mergePhaseEntries` from `src/bank/normalize.ts`.

## 9. Performance and robustness notes

- The corpus is compiled into modules and frozen at import time — no JSON parse
  at boot, no file I/O for built-in data.
- Merging runs on bank/config changes only (startup, external reload, settings
  change, preset switch), never per animation frame. It is O(total entries)
  with set lookups, and duplicates cost nothing extra.
- The external loader's 2 s poll is a single `stat` fast path by default; a
  file is only read/parsed when its mtime (ns) or size changed, and the text is
  compared before a reload is accepted, so a `touch` does not churn the bank.
- The watcher uses `fs.watchFile` with `persistent: false` and is removed by
  `stop()`, so a headless or unloaded plugin leaves no handle behind.
- No network, no eval, no dynamic `require`; the external file is pure data.
- All failures are data-shaped (`BankWarning` / status / log callback), so a
  broken bank can never throw into a cordis event handler or block TUI boot.

## 10. Verification

```bash
npm run build                       # tests import lib/types/**
node --test "test/bank/*.test.ts"   # 64 bank tests
node --test                         # whole suite (discovers test/ recursively)
```

What `test/bank/*.test.ts` pins:

- corpus: 14 packs in order, labels, per-pack/per-phase counts, totals 1362
  (zh 746 / en 616), default 945 (zh 505 / en 440), 5 weighted entries, corpus
  SHA-256, deep-frozen data, zero dedupe loss when merging all packs;
- normalization: every invalid-entry path (text, weight, rarity, `when`,
  groups, packs, documents), legacy flat array, legacy shared phrase table,
  only-three-keys rule, label handling, duplicate pack ids, `enabledPacks`
  filtering, warning codes/paths;
- merge: order, per-language+phase dedupe with first weight kept, `[]` /
  `null` / unknown-id selection, `includedPacks`, `extraCore` last, degrade
  without throwing;
- external loader: path precedence and `~`/relative expansion, missing file =
  off, initial load, idempotent start, corrupt/invalid file keeps last good and
  exposes the error, recovery without restart, deletion triggers
  `onReload({})`, only three keys survive, onReload exceptions isolated,
  env/file overrides, the 2 s watcher detects changes and `stop()` detaches it.