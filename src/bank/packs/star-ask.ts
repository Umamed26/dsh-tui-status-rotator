/**
 * Built-in phrase pack `star-ask` — 求 star / Star asks.
 * 23 entries (zh.thinking 9, zh.running 1, zh.long 1, en.thinking 10, en.running 1, en.long 1).
 *
 * Extracted verbatim from dsh-status-rotator config.example.json.
 * Do not translate, reorder or edit the copy: test/bank/data.test.ts pins
 * the whole corpus with a SHA-256 over its canonical JSON.
 *
 * @module dsh-tui-status-rotator/bank/packs/star-ask
 */
import type { PackDoc } from '../../types.js'
export const PACK_STAR_ASK: PackDoc = {
  id: "star-ask",
  label: { zh: "求 star", en: "Star asks" },
  phrases: {
    zh: {
      thinking: [
        "正在向你讨一个 star…",
        "求个 star 再赶路…",
        "star 已到账,干劲十足…",
        "正在用 star 发电…",
        "星星在等你点亮…",
        "点个 star 再走呗…",
        "正在向 GitHub 仓库飞奔…",
        "正在 github 上等你点星…",
        "已加星用户,优先加速…",
      ],
      running: [
        "仍在等你那个 star…",
      ],
      long: [
        "想要星星想到自闭…",
      ],
    },
    en: {
      thinking: [
        "Begging for a star…",
        "Running on pure star power…",
        "Powered by stargazers…",
        "Converting stars into electricity…",
        "Starring you back…",
        "Routing to 01Virex/dsh-status-rotator…",
        "Starring the repo dsh-status-rotator…",
        "github.com/01Virex/dsh-status-rotator…",
        "Stargazers get priority routing…",
        "Posting new phrases to the repo issues…",
      ],
      running: [
        "Still waiting for your star…",
      ],
      long: [
        "Star-deprived and slowly shrieking…",
      ],
    },
  },
};
