/**
 * Plugin configuration: the cordis-patch Config schema plus the pure resolver
 * that turns raw (untrusted) config values into a fully-defaulted, clamped
 * ResolvedConfig.
 *
 * Editable knobs are marked Schemastery-volatile: the host settings service
 * projects only volatile fields into its forms, and dsh-TUI's settings section
 * (seam 6) edits them through revision-fenced settings.mutate path ops. The
 * advanced keys (packs/presets/schedule) are intentionally NOT volatile -
 * dsh-TUI's declarative field kinds cannot edit nested arrays, so they stay
 * profile-patch / bank-file territory and are documented as such.
 *
 * @module dsh-tui-status-rotator/config
 */
import z from '@deepseek-ai/schemastery'
import type { ResolvedConfig, ScheduleRuleInput, PresetInput, BankWarning } from './types.js'

/** Raw config as declared in the profile patch and projected by the settings service. */
export type Config = {
  enabled?: boolean
  language?: string
  intervalMs?: number
  typeSpeedMs?: number
  thinkingMs?: number
  longAfterMs?: number
  weightedRandom?: boolean
  antiRepeatRecentLimit?: number
  labelSource?: string
  gradientEnabled?: boolean
  gradientMode?: string
  gradientDirection?: string
  gradientColors?: string
  gradientDayColors?: string
  gradientSpeedSec?: number
  /** Advanced: undefined = built-in default pack set; [] = core phrases only. */
  enabledPacks?: string[] | null
  /** Advanced: named phrase presets. */
  presets?: PresetInput[]
  /** Advanced: weekly preset schedule. */
  schedule?: ScheduleRuleInput[]
  /** Advanced: preset pinned as the non-scheduled choice. */
  activePreset?: string | null
  /** Advanced: external bank file path override (undefined = default path). */
  bankPath?: string | null
}

/** Default night palette, ported from dsh-status-rotator's config.example.json. */
export const DEFAULT_GRADIENT_COLORS: readonly string[] = [
  '#ff5f6d', '#ffc371', '#ffdd55', '#7dff7d', '#5fd4ff', '#a78bfa', '#ff8adb',
]

/** Default day palette, ported from dsh-status-rotator's config.example.json. */
export const DEFAULT_GRADIENT_DAY_COLORS: readonly string[] = [
  '#d92b4b', '#c2410c', '#a16207', '#15803d', '#0e7490', '#6d28d9', '#be185d',
]

/**
 * Adaptive palette used by gradientMode 'theme': host theme color keys the
 * status view's ThemedText resolves per active theme, so the rainbow follows
 * light/dark themes without the plugin knowing the theme name (dsh-TUI does
 * not expose the active theme to rich status views).
 */
export const THEME_GRADIENT_PALETTE: readonly string[] = [
  'accent', 'activity', 'warning', 'success', 'professionalBlue', 'chromeYellow', 'error', 'planMode',
]

/** Editable keys: only these are projected into the host settings form. */
const EDITABLE_KEYS = [
  'enabled', 'language', 'intervalMs', 'typeSpeedMs', 'thinkingMs', 'longAfterMs',
  'weightedRandom', 'antiRepeatRecentLimit', 'labelSource',
  'gradientEnabled', 'gradientMode', 'gradientDirection', 'gradientColors',
  'gradientDayColors', 'gradientSpeedSec',
] as const

type SchemaLike = {
  dict?: Record<string, { volatile?: () => unknown; meta?: { volatile?: boolean } }>
}

/**
 * Mark the listed top-level fields volatile so the host settings service
 * exposes them as editable live fields. Older schemastery builds without the
 * API leave the schema untouched (the plugin still runs from the patch config;
 * only the settings form degrades), and we never throw at boot.
 */
function markVolatile<T>(schema: T, keys: readonly string[]): T {
  const dict = (schema as SchemaLike).dict
  if (dict === undefined) return schema
  for (const key of keys) {
    const field = dict[key]
    if (field === undefined) continue
    if (field.meta?.volatile === true) continue
    if (typeof field.volatile !== 'function') continue
    try {
      dict[key] = field.volatile() as typeof field
    } catch {
      // Old/foreign schemastery build: keep the plain field.
    }
  }
  return schema
}

const rawSchema = z.object({
  enabled: z.boolean().default(true),
  language: z.string().default('auto'),
  intervalMs: z.number().default(10_000),
  typeSpeedMs: z.number().default(30),
  thinkingMs: z.number().default(15_000),
  longAfterMs: z.number().default(60_000),
  weightedRandom: z.boolean().default(true),
  antiRepeatRecentLimit: z.number().default(3),
  labelSource: z.string().default('phrases'),
  gradientEnabled: z.boolean().default(true),
  gradientMode: z.string().default('theme'),
  gradientDirection: z.string().default('rtl'),
  gradientColors: z.string().default(DEFAULT_GRADIENT_COLORS.join(',')),
  gradientDayColors: z.string().default(DEFAULT_GRADIENT_DAY_COLORS.join(',')),
  gradientSpeedSec: z.number().default(4),
  enabledPacks: z.union([z.array(z.string()), z.const(null)]).default(undefined as unknown as null),
  presets: z.array(z.any()).default([]),
  schedule: z.array(z.any()).default([]),
  activePreset: z.union([z.string(), z.const(null)]).default(null),
  bankPath: z.union([z.string(), z.const(null)]).default(null),
})

/** The plugin's Config schema (declared in package.json's plugin contract). */
export const Config = markVolatile(rawSchema, EDITABLE_KEYS) as unknown as Schemastery<Config>

/** Read one config value that may be a settings-service volatile getter. */
function readValue(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && 'get' in value && typeof (value as { get?: unknown }).get === 'function') {
    try {
      return (value as { get(): unknown }).get()
    } catch {
      return undefined
    }
  }
  return value
}

/** Clamp a numeric field, recording a warning when the input was unusable. */
function clampNumber(
  warnings: BankWarning[],
  code: string,
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(numeric)) {
    if (value !== undefined && value !== null) warnings.push({ code, message: code + ': expected a number, using ' + fallback })
    return fallback
  }
  const clamped = Math.min(max, Math.max(min, Math.round(numeric)))
  if (clamped !== numeric) warnings.push({ code, message: code + ': ' + numeric + ' is out of range, clamped to ' + clamped })
  return clamped
}

/** Parse a comma-separated color list; invalid entries are dropped with a warning. */
export function parseColorList(
  warnings: BankWarning[],
  code: string,
  value: unknown,
  fallback: readonly string[],
  themeKeys: ReadonlySet<string>,
): readonly string[] {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  const parsed: string[] = []
  for (const part of value.split(',')) {
    const candidate = part.trim()
    if (candidate === '') continue
    if (isSafeColor(candidate, themeKeys)) parsed.push(candidate)
    else warnings.push({ code, message: code + ': rejected color "' + candidate.slice(0, 32) + '"' })
  }
  if (parsed.length < 2) {
    if (parsed.length !== 0) warnings.push({ code, message: code + ': needs at least 2 colors, using default palette' })
    return fallback
  }
  return parsed
}

/** Whether a color is a safe hex/rgb/ansi value or a known host theme key. */
export function isSafeColor(value: string, themeKeys: ReadonlySet<string> = new Set()): boolean {
  if (/#[0-9a-fA-F]{3,8}$/.test(value) && /^#[0-9a-fA-F]{3,8}$/.test(value)) return true
  if (/^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/.test(value)) return true
  if (/^ansi256\(\d{1,3}\)$/.test(value)) return true
  if (/^ansi:[a-zA-Z0-9]+$/.test(value)) return true
  return themeKeys.has(value)
}

/** Choose one of a fixed set, warning when the input is unknown. */
function oneOf<T extends string>(warnings: BankWarning[], code: string, value: unknown, fallback: T, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  if (value !== undefined) warnings.push({ code, message: code + ': unknown value "' + String(value).slice(0, 32) + '", using ' + fallback })
  return fallback
}

/**
 * Detect the UI language for 'auto': DSH_TUI_LANG -> ~/.dsh-tui/lang.json ->
 * OS locale -> zh. All injected reads are total: a missing/corrupt source
 * never breaks resolution.
 */
export function detectLanguage(env: NodeJS.ProcessEnv, readLangFile: () => unknown, systemLocale: string): 'zh' | 'en' {
  const fromEnv = env.DSH_TUI_LANG
  if (fromEnv === 'zh' || fromEnv === 'en') return fromEnv
  try {
    const fileLang = readLangFile()
    if (fileLang === 'zh' || fileLang === 'en') return fileLang
  } catch {
    // fall through
  }
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** Fully defaulted defaults (exported for tests and docs). */
export const DEFAULT_RESOLVED_CONFIG: ResolvedConfig = Object.freeze({
  enabled: true,
  language: 'auto',
  intervalMs: 10_000,
  typeSpeedMs: 30,
  thinkingMs: 15_000,
  longAfterMs: 60_000,
  weightedRandom: true,
  antiRepeatRecentLimit: 3,
  labelSource: 'phrases',
  gradientEnabled: true,
  gradientMode: 'theme',
  gradientDirection: 'rtl',
  gradientColors: DEFAULT_GRADIENT_COLORS,
  gradientDayColors: DEFAULT_GRADIENT_DAY_COLORS,
  gradientSpeedSec: 4,
  presets: [],
  schedule: [],
  activePreset: null,
})

const THEME_KEYS = new Set([
  'autoAccept', 'bashBorder', 'accent', 'toolNameMutate', 'toolNameExec', 'accentShimmer',
  'activity', 'activityShimmer', 'permission', 'permissionShimmer', 'planMode', 'ide',
  'promptBorder', 'promptBorderShimmer', 'text', 'inverseText', 'inactive', 'inactiveShimmer',
  'subtle', 'suggestion', 'remember', 'background', 'success', 'error', 'warning', 'merged',
  'warningShimmer', 'professionalBlue', 'chromeYellow', 'ignition', 'ignitionDim', 'toolDotExec',
  'toolDotRead', 'toolDotWrite', 'toolDotWeb', 'toolDotTask',
])

/**
 * Resolve raw config (from the cordis patch row / settings getters) into a
 * fully-defaulted ResolvedConfig. Never throws: invalid input falls back with
 * a warning so the UI can state WHY a value was ignored.
 */
export function resolveConfig(raw: Config | undefined): { config: ResolvedConfig; warnings: readonly BankWarning[] } {
  const warnings: BankWarning[] = []
  const source: Record<string, unknown> = {}
  if (raw !== undefined && raw !== null && typeof raw === 'object') {
    for (const key of Object.keys(raw)) source[key] = readValue((raw as Record<string, unknown>)[key])
  }
  const thinkingMs = clampNumber(warnings, 'config.thinkingMs', source.thinkingMs, DEFAULT_RESOLVED_CONFIG.thinkingMs, 0, 600_000)
  const longAfterMs = clampNumber(warnings, 'config.longAfterMs', source.longAfterMs, DEFAULT_RESOLVED_CONFIG.longAfterMs, 0, 3_600_000)
  const gradientMode = oneOf(warnings, 'config.gradientMode', source.gradientMode, DEFAULT_RESOLVED_CONFIG.gradientMode, ['theme', 'day', 'night'])
  const enabledPacks = (() => {
    const value = source.enabledPacks
    if (value === undefined) return undefined
    if (value === null) return null
    if (!Array.isArray(value)) {
      warnings.push({ code: 'config.enabledPacks', message: 'config.enabledPacks: expected an array of pack ids or null' })
      return undefined
    }
    return value.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map(id => id.trim())
  })()
  const activePreset = (() => {
    const value = source.activePreset
    if (value === undefined) return null
    if (value === null) return null
    if (typeof value !== 'string') {
      warnings.push({ code: 'config.activePreset', message: 'config.activePreset: expected a preset id or null' })
      return null
    }
    return value
  })()
  const presets = Array.isArray(source.presets) ? (source.presets.filter(isPreset) as PresetInput[]) : []
  if (!Array.isArray(source.presets) && source.presets !== undefined) {
    warnings.push({ code: 'config.presets', message: 'config.presets: expected an array; ignored' })
  }
  const schedule = Array.isArray(source.schedule) ? (source.schedule.filter(isScheduleRule) as ScheduleRuleInput[]) : []
  if (!Array.isArray(source.schedule) && source.schedule !== undefined) {
    warnings.push({ code: 'config.schedule', message: 'config.schedule: expected an array; ignored' })
  }
  const config: ResolvedConfig = {
    enabled: source.enabled === undefined ? DEFAULT_RESOLVED_CONFIG.enabled : source.enabled === true,
    language: oneOf(warnings, 'config.language', source.language, DEFAULT_RESOLVED_CONFIG.language, ['auto', 'zh', 'en']),
    intervalMs: clampNumber(warnings, 'config.intervalMs', source.intervalMs, DEFAULT_RESOLVED_CONFIG.intervalMs, 500, 600_000),
    typeSpeedMs: clampNumber(warnings, 'config.typeSpeedMs', source.typeSpeedMs, DEFAULT_RESOLVED_CONFIG.typeSpeedMs, 0, 2_000),
    thinkingMs,
    longAfterMs: Math.max(thinkingMs, longAfterMs),
    weightedRandom: source.weightedRandom === undefined ? DEFAULT_RESOLVED_CONFIG.weightedRandom : source.weightedRandom === true,
    antiRepeatRecentLimit: clampNumber(warnings, 'config.antiRepeatRecentLimit', source.antiRepeatRecentLimit, DEFAULT_RESOLVED_CONFIG.antiRepeatRecentLimit, 0, 50),
    labelSource: oneOf(warnings, 'config.labelSource', source.labelSource, DEFAULT_RESOLVED_CONFIG.labelSource, ['phrases', 'host']),
    gradientEnabled: source.gradientEnabled === undefined ? DEFAULT_RESOLVED_CONFIG.gradientEnabled : source.gradientEnabled === true,
    gradientMode,
    gradientDirection: oneOf(warnings, 'config.gradientDirection', source.gradientDirection, DEFAULT_RESOLVED_CONFIG.gradientDirection, ['rtl', 'ltr']),
    gradientColors: parseColorList(warnings, 'config.gradientColors', source.gradientColors, DEFAULT_RESOLVED_CONFIG.gradientColors, THEME_KEYS),
    gradientDayColors: parseColorList(warnings, 'config.gradientDayColors', source.gradientDayColors, DEFAULT_RESOLVED_CONFIG.gradientDayColors, THEME_KEYS),
    gradientSpeedSec: clampNumber(warnings, 'config.gradientSpeedSec', source.gradientSpeedSec, DEFAULT_RESOLVED_CONFIG.gradientSpeedSec, 1, 60),
    enabledPacks,
    presets,
    schedule,
    activePreset,
    bankPath: typeof source.bankPath === 'string' && source.bankPath.trim() !== '' ? source.bankPath.trim() : null,
  }
  return { config, warnings }
}

/** Structural preset filter (external config is untrusted JSON). */
function isPreset(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && record.id.trim() !== ''
}

/** Structural schedule-rule filter (external config is untrusted JSON). */
function isScheduleRule(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.preset === 'string'
    && typeof record.from === 'string'
    && typeof record.to === 'string'
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(record.from)
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(record.to)
    && (record.days === undefined || (Array.isArray(record.days) && record.days.every(day => Number.isInteger(day) && day >= 1 && day <= 7)))
}
