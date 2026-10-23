/** Localized phase label used by {phaseLabel} and the command output. */
export function phaseLabel(phase, lang) {
    if (lang === 'en') {
        return phase === 'thinking' ? 'thinking' : phase === 'running' ? 'running' : 'long-running';
    }
    return phase === 'thinking' ? '思考中' : phase === 'running' ? '运行中' : '长任务中';
}
/** Localized strings for plugin-facing output. */
const DICTIONARY = {
    zh: {
        'cmd.description': '控制状态行轮换：next / on / off / status',
        'cmd.next': '已换下一句',
        'cmd.on': '已启用（本次运行；长期设置请到 /settings）',
        'cmd.off': '已停用（本次运行；长期设置请到 /settings）',
        'cmd.unknown': '未知子命令，可用：next | on | off | status',
        'status.header': '状态轮换',
        'status.enabled': '启用',
        'status.line': '当前文案',
        'status.phase': '阶段',
        'status.packs': '词库包',
        'status.lang': '语言',
        'status.host': '宿主接缝',
        'status.bank': '词库',
        'status.errors': '异常',
        'status.none': '无',
    },
    en: {
        'cmd.description': 'Control the rotating status line: next / on / off / status',
        'cmd.next': 'advanced to the next phrase',
        'cmd.on': 'enabled for this run (persist via /settings)',
        'cmd.off': 'disabled for this run (persist via /settings)',
        'cmd.unknown': 'unknown subcommand, use: next | on | off | status',
        'status.header': 'status rotator',
        'status.enabled': 'enabled',
        'status.line': 'line',
        'status.phase': 'phase',
        'status.packs': 'packs',
        'status.lang': 'language',
        'status.host': 'host seams',
        'status.bank': 'bank',
        'status.errors': 'errors',
        'status.none': 'none',
    },
};
/** Translate one key. */
export function t(lang, key) {
    return DICTIONARY[lang][key];
}
