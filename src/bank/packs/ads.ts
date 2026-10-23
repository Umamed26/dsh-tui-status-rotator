/**
 * Built-in phrase pack `ads` — 广告 / Ads.
 * 6 entries (zh.running 3, en.running 3).
 *
 * Extracted verbatim from dsh-status-rotator config.example.json.
 * Do not translate, reorder or edit the copy: test/bank/data.test.ts pins
 * the whole corpus with a SHA-256 over its canonical JSON.
 *
 * @module dsh-tui-status-rotator/bank/packs/ads
 */
import type { PackDoc } from '../../types.js'
export const PACK_ADS: PackDoc = {
  id: "ads",
  label: { zh: "广告", en: "Ads" },
  phrases: {
    zh: {
      running: [
        "正在优化提示词 github.com/WestFox-AwA/dsh-prompt-optimizer…",
        "正在操控 blender github.com/sixtysevenlf/dsh-blender-plugin…",
        "正在切换工作人格 github.com/shenA2024/whale-persona…",
      ],
    },
    en: {
      running: [
        "Optimizing the prompt github.com/WestFox-AwA/dsh-prompt-optimizer…",
        "Driving Blender github.com/sixtysevenlf/dsh-blender-plugin…",
        "Switching work personas github.com/shenA2024/whale-persona…",
      ],
    },
  },
};
