import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.js';
import type { Config as PluginConfig } from './config.js';
export declare const name = "status-rotator";
/** Re-export the config schema so the cordis entry owns the documented contract. */
export { Config };
/**
 * Wire the plugin into the cordis application.
 * @param ctx - Cordis context (dsh-TUI's plugin seams live on it).
 * @param config - Row config from the profile patch; every key is optional.
 */
export declare function apply(ctx: Context, config?: PluginConfig): void;
