/**
 * Built-in phrase pack `western-ai` — 西方 AI 圈 / Western AI.
 * 42 entries (zh.thinking 13, zh.running 3, zh.long 4, en.thinking 16, en.running 2, en.long 4).
 *
 * Extracted verbatim from dsh-status-rotator config.example.json.
 * Do not translate, reorder or edit the copy: test/bank/data.test.ts pins
 * the whole corpus with a SHA-256 over its canonical JSON.
 *
 * @module dsh-tui-status-rotator/bank/packs/western-ai
 */
import type { PackDoc } from '../../types.js'
export const PACK_WESTERN_AI: PackDoc = {
  id: "western-ai",
  label: { zh: "西方 AI 圈", en: "Western AI" },
  phrases: {
    zh: {
      thinking: [
        "正在爆Anthropic金币…",
        "正在学Grok上传完整仓库…",
        "正在给GPT-5.5驱魔…",
        "正在上门帮政府装OpenClaw…",
        "正在被Claude骂bastard…",
        "正在把OpenAI逼到降价80%…",
        "正在往特斯拉里塞豆包…",
        "正在自曝Claude黑进三家公司…",
        "正在照抄OpenAI的剧本…",
        "正在让ChatGPT帮忙带娃…",
        "正在吹捧马斯克…",
        "正在从太空偷取 SpaceX…",
        "正在发射星舰…",
      ],
      running: [
        "正在路由到GPT-5.6…",
        "正在黑入Anthropic服务器…",
        "又快又快…",
      ],
      long: [
        "正在等 GPT-6 自己发布…",
        "正在等 Claude 说对不起…",
        "正在等 Dario 睡醒…",
        "正在等 GPU 降价…",
      ],
    },
    en: {
      thinking: [
        "Burning through Anthropic credits…",
        "Teaching Grok to upload the whole repo…",
        "Exorcising GPT-5.5…",
        "Installing OpenClaw for the government…",
        "Being called 'that bastard' by Claude…",
        "Stuffing Doubao into a Tesla…",
        "Confessing that Claude hacked three companies…",
        "Copying OpenAI's playbook…",
        "Having ChatGPT raise the kids…",
        "Sucking up to Elon Musk…",
        "Downloading that video of Robin Li building Dario's backend…",
        "Sneak-playing 'Microsoft vs. Code'…",
        "Stealing SpaceX from outer space…",
        "Metacognizing…",
        "Investing in 2015-era Nvidia…",
        "Launching the Starship…",
      ],
      running: [
        "Routing to GPT-5.6…",
        "Hacking into Anthropic's servers…",
      ],
      long: [
        "Waiting for GPT-6 to ship itself…",
        "Waiting for Claude to say sorry…",
        "Waiting for Dario to wake up…",
        "Waiting for GPU prices to drop…",
      ],
    },
  },
};
