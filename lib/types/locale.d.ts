/**
 * Small zh/en dictionary for the command output and settings labels. Phrase
 * copy itself lives in the bank, not here.
 *
 * @module dsh-tui-status-rotator/locale
 */
import type { Lang, Phase } from './types.js';
/** Localized phase label used by {phaseLabel} and the command output. */
export declare function phaseLabel(phase: Phase, lang: Lang): string;
/** Localized strings for plugin-facing output. */
declare const DICTIONARY: {
    readonly zh: {
        readonly 'cmd.description': "控制状态行轮换：next / on / off / status";
        readonly 'cmd.next': "已换下一句";
        readonly 'cmd.on': "已启用（本次运行；长期设置请到 /settings）";
        readonly 'cmd.off': "已停用（本次运行；长期设置请到 /settings）";
        readonly 'cmd.unknown': "未知子命令，可用：next | on | off | status";
        readonly 'status.header': "状态轮换";
        readonly 'status.enabled': "启用";
        readonly 'status.line': "当前文案";
        readonly 'status.phase': "阶段";
        readonly 'status.packs': "词库包";
        readonly 'status.lang': "语言";
        readonly 'status.host': "宿主接缝";
        readonly 'status.bank': "词库";
        readonly 'status.errors': "异常";
        readonly 'status.none': "无";
    };
    readonly en: {
        readonly 'cmd.description': "Control the rotating status line: next / on / off / status";
        readonly 'cmd.next': "advanced to the next phrase";
        readonly 'cmd.on': "enabled for this run (persist via /settings)";
        readonly 'cmd.off': "disabled for this run (persist via /settings)";
        readonly 'cmd.unknown': "unknown subcommand, use: next | on | off | status";
        readonly 'status.header': "status rotator";
        readonly 'status.enabled': "enabled";
        readonly 'status.line': "line";
        readonly 'status.phase': "phase";
        readonly 'status.packs': "packs";
        readonly 'status.lang': "language";
        readonly 'status.host': "host seams";
        readonly 'status.bank': "bank";
        readonly 'status.errors': "errors";
        readonly 'status.none': "none";
    };
};
export type LocaleKey = keyof (typeof DICTIONARY)['zh'];
/** Translate one key. */
export declare function t(lang: Lang, key: LocaleKey): string;
export {};
