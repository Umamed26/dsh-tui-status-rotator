/** English section title (also the fallback title). */
export const SETTINGS_SECTION_TITLE = 'Status rotator';
/** zh/en section title. */
const SECTION_DESCRIPTIONS = Object.freeze({ zh: '状态轮换', en: SETTINGS_SECTION_TITLE });
/** The 15 editable config keys (must mirror src/config.ts EDITABLE_KEYS). */
export const EDITABLE_SETTINGS_KEYS = Object.freeze([
    'enabled',
    'language',
    'intervalMs',
    'typeSpeedMs',
    'thinkingMs',
    'longAfterMs',
    'weightedRandom',
    'antiRepeatRecentLimit',
    'labelSource',
    'gradientEnabled',
    'gradientMode',
    'gradientDirection',
    'gradientColors',
    'gradientDayColors',
    'gradientSpeedSec',
]);
/** One copy block per editable key. */
const COPY = Object.freeze({
    enabled: {
        en: 'Enabled',
        zh: '启用',
        hintEn: 'Show the rotating status line above the prompt',
        hintZh: '在输入框上方显示轮换状态行',
    },
    language: {
        en: 'Phrase language',
        zh: '文案语言',
        hintEn: 'Language of the phrase pool; auto follows the TUI language',
        hintZh: '词库语言；auto 跟随 TUI 界面语言',
    },
    intervalMs: {
        en: 'Rotation interval (ms)',
        zh: '轮换间隔（毫秒）',
        hintEn: 'Milliseconds between phrase rotations (500-600000)',
        hintZh: '每句文案停留的毫秒数（500-600000）',
    },
    typeSpeedMs: {
        en: 'Typewriter speed (ms)',
        zh: '打字机速度（毫秒）',
        hintEn: 'Per-grapheme reveal interval; 0 shows the whole phrase at once (0-2000)',
        hintZh: '每个字符的显示间隔；0 表示整句直接显示（0-2000）',
    },
    thinkingMs: {
        en: 'Thinking phase (ms)',
        zh: '思考阶段（毫秒）',
        hintEn: 'Turn elapsed time before the phase becomes running (0-600000)',
        hintZh: '回合开始多久后从「思考中」进入「运行中」（0-600000）',
    },
    longAfterMs: {
        en: 'Long-task phase (ms)',
        zh: '长任务阶段（毫秒）',
        hintEn: 'Turn elapsed time before the phase becomes long-running (0-3600000)',
        hintZh: '回合开始多久后进入「长任务中」（0-3600000）',
    },
    weightedRandom: {
        en: 'Weighted random',
        zh: '加权随机',
        hintEn: 'Draw phrases by their weight instead of uniformly',
        hintZh: '按词条权重抽取，而不是等概率抽取',
    },
    antiRepeatRecentLimit: {
        en: 'Anti-repeat memory',
        zh: '反重复记忆',
        hintEn: 'How many recent phrases are avoided across shuffle bags (0-50)',
        hintZh: '跨洗牌袋记住多少条最近文案以避免立刻重复（0-50）',
    },
    labelSource: {
        en: 'Label source',
        zh: '标签来源',
        hintEn: 'phrases shows this plugin line; host leaves the host line untouched',
        hintZh: 'phrases 显示本插件文案；host 不改动宿主自己的状态行',
    },
    gradientEnabled: {
        en: 'Gradient',
        zh: '渐变',
        hintEn: 'Color each grapheme with a palette sweep',
        hintZh: '为每个字符按调色板着色',
    },
    gradientMode: {
        en: 'Gradient palette',
        zh: '渐变调色板',
        hintEn: 'theme follows host theme colors; day/night use the palettes below',
        hintZh: 'theme 跟随宿主主题色；day/night 使用下面的自定义调色板',
    },
    gradientDirection: {
        en: 'Gradient direction',
        zh: '渐变方向',
        hintEn: 'Direction the palette sweeps across the line',
        hintZh: '调色板在整行上的流动方向',
    },
    gradientColors: {
        en: 'Night palette',
        zh: '夜间调色板',
        hintEn: 'Comma-separated colors (hex/rgb/ansi or host theme key, at least 2)',
        hintZh: '逗号分隔的颜色（hex/rgb/ansi 或宿主主题色键，至少 2 个）',
    },
    gradientDayColors: {
        en: 'Day palette',
        zh: '日间调色板',
        hintEn: 'Comma-separated day-mode colors (at least 2)',
        hintZh: '逗号分隔的日间模式颜色（至少 2 个）',
    },
    gradientSpeedSec: {
        en: 'Gradient cycle (s)',
        zh: '渐变周期（秒）',
        hintEn: 'Seconds for one full palette cycle (1-60)',
        hintZh: '调色板走完一整轮所需的秒数（1-60）',
    },
});
/** zh/en label pair for a select option. */
function option(value, en, zh) {
    return { value, label: en, descriptions: { zh, en } };
}
/** English label for each select option set. */
const SELECT_OPTIONS = Object.freeze({
    language: Object.freeze([
        option('auto', 'Auto', '自动'),
        option('zh', 'Chinese', '中文'),
        option('en', 'English', 'English'),
    ]),
    labelSource: Object.freeze([
        option('phrases', 'Phrases (this plugin)', '使用本插件文案'),
        option('host', 'Host (leave untouched)', '保留宿主状态行'),
    ]),
    gradientMode: Object.freeze([
        option('theme', 'Host theme', '宿主主题'),
        option('day', 'Day palette', '日间调色板'),
        option('night', 'Night palette', '夜间调色板'),
    ]),
    gradientDirection: Object.freeze([
        option('rtl', 'Right to left', '从右到左'),
        option('ltr', 'Left to right', '从左到右'),
    ]),
});
/** Field kind per editable key (mirrors the Schemastery types in config.ts). */
const KINDS = Object.freeze({
    enabled: 'boolean',
    language: 'select',
    intervalMs: 'number',
    typeSpeedMs: 'number',
    thinkingMs: 'number',
    longAfterMs: 'number',
    weightedRandom: 'boolean',
    antiRepeatRecentLimit: 'number',
    labelSource: 'select',
    gradientEnabled: 'boolean',
    gradientMode: 'select',
    gradientDirection: 'select',
    gradientColors: 'text',
    gradientDayColors: 'text',
    gradientSpeedSec: 'number',
});
/** Build the declarative section for a settings namespace (pure, exported for tests). */
export function buildSettingsSection(ns) {
    const fields = EDITABLE_SETTINGS_KEYS.map(key => {
        const copy = COPY[key];
        const selectOptions = SELECT_OPTIONS[key];
        const field = {
            path: [key],
            label: copy.en,
            descriptions: { zh: copy.zh, en: copy.en },
            kind: KINDS[key],
            hint: copy.hintEn,
            hintDescriptions: { zh: copy.hintZh, en: copy.hintEn },
            ...(selectOptions === undefined ? {} : { options: selectOptions }),
        };
        return field;
    });
    const base = {
        ns,
        title: SETTINGS_SECTION_TITLE,
        descriptions: { zh: SECTION_DESCRIPTIONS.zh, en: SECTION_DESCRIPTIONS.en },
        fields,
    };
    // A dedicated tab makes the section feel native; only declare it when the
    // namespace is a legal page id (Loader ids are, but tests/embeds may not be).
    if (!/^[a-z][a-z0-9_-]*$/u.test(ns))
        return base;
    return {
        ...base,
        page: {
            id: ns,
            title: SETTINGS_SECTION_TITLE,
            descriptions: { zh: SECTION_DESCRIPTIONS.zh, en: SECTION_DESCRIPTIONS.en },
        },
    };
}
/**
 * Register the settings section (seam 6). Returns the host's unregister
 * disposer, or `undefined` when the seam is absent or refuses the section
 * (duplicate namespace, invalid ns). Never throws; every degradation is a
 * diagnostic.
 */
export function registerSettingsSection(_ctx, ports, options) {
    const service = ports.settingsSections;
    if (service === undefined || service === null) {
        options.diagnostics.warn('settings.unavailable', 'tuiSettingsSections is unavailable; edit the profile patch or ~/.dsh/settings.yaml instead');
        return undefined;
    }
    if (typeof service.register !== 'function') {
        options.diagnostics.warn('settings.unavailable', 'tuiSettingsSections.register is unavailable; the /settings section cannot be registered');
        return undefined;
    }
    const ns = typeof options.ns === 'string' && options.ns.trim() !== '' ? options.ns.trim() : 'status-rotator';
    let section;
    try {
        section = buildSettingsSection(ns);
    }
    catch (error) {
        options.diagnostics.warn('settings.build-failed', 'could not build the settings section: ' + describe(error));
        return undefined;
    }
    try {
        const dispose = service.register(section);
        if (typeof dispose !== 'function') {
            options.diagnostics.warn('settings.register-no-disposer', 'tuiSettingsSections.register returned no disposer; the section is treated as unregistered');
            return undefined;
        }
        return dispose;
    }
    catch (error) {
        options.diagnostics.warn('settings.register-failed', 'the host refused the "' + ns + '" settings section: ' + describe(error));
        return undefined;
    }
}
/** Short single-line error text (never throws). */
function describe(error) {
    try {
        if (error instanceof Error)
            return error.message.replace(/\s+/gu, ' ').slice(0, 200);
        return String(error).replace(/\s+/gu, ' ').slice(0, 200);
    }
    catch {
        return 'unknown error';
    }
}
