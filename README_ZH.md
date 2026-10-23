# dsh-tui-status-rotator

> 把 [dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator) 的状态行轮换移植进 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)：**阶段感知文案、打字机、主题自适应渐变、加权洗牌袋反重复、14 个主题词库包、条件句与实时占位符、预设与时段调度**，并接入 dsh-TUI 原生的 `/settings` 设置区块与 `/status-rotator` 命令。

[English](./README.md) · [效果](#效果) · [安装](#安装) · [设置](#设置) · [命令](#命令) · [高级配置](#高级配置) · [与原插件的差异](#与原-web-插件的差异) · [排障](#排障)

这是 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的 **dsh-TUI 生态插件**：它为 dsh-TUI 的提示框上方提供一行轮换状态文案，工作方式与 web 版一致，只是渲染与配置落到了终端宿主自己的接缝上。

## 效果

回合进行中，提示框上方会出现一行随阶段轮换的文案（真机帧示例，`◌` / `●` / `◍` 为阶段指示符）：

```text
◌ 正在自刎归天…
● 正在灰度一个不该上线的功能…
```

（示例取自随包词库的真实条目，可在 `src/bank/packs/` 找到原文与出处包。）

- 逐字出现（打字机），整句出现后按设定间隔换成下一句；
- 每个字按色板流动上色（默认使用宿主主题色板，深浅色主题自动适配）；
- 阶段切换（思考 ◌ → 运行 ● → 长任务 ◍）立即换句，不必等轮换间隔；
- 回合结束、会话空闲、或插件被关掉时整行消失，不占位、不闪烁、不抢焦点；
- 与宿主自带的 working-activity 行共存：本插件只新增自己的一行，不覆盖宿主文案。

## 安装

要求 dsh-TUI **v0.16+**（接缝 `tuiStatus.registerView` / `tuiSettingsSections`）。插件随包提供 `dsh-plugin.json`（Community v0.15 声明面）与 `cordis.patch.yml`（profile 组合行）。

```sh
# 发布后（npm）
dsh plugin --profile dsh-tui add dsh-tui-status-rotator

# 本地开发：构建后把包目录装进 profile
npm install && npm run build
dsh plugin --profile dsh-tui add file:/绝对路径/dsh-tui-status-rotator
```

安装后重启 dsh-TUI，发起一个回合即可看到状态行。卸载：

```sh
dsh plugin --profile dsh-tui remove dsh-tui-status-rotator
```

`remove` 不会删除你的数据：外部词库文件与插件自己的缓存都留在 `~/.dsh-tui/status-rotator/`，由你决定是否清理（见[卸载与数据](#卸载与数据)）。

## 设置

打开 dsh-TUI 的 **`/settings`**，会多出 **「状态轮换 / Status rotator」** 一页（接缝 `tuiSettingsSections`）。所有字段即改即生效、由宿主的 revision 栅栏写回 profile，不需要重启；值改回默认后 profile 里的覆盖行会自动收回。真机回放已验证「勾选 → 落盘 → 热应用 → 回退默认」四步闭环（见 [真机回放记录](./docs/real-tty-replay.md)）。

| 字段 | 默认 | 范围 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `true` | 开/关 | 总开关；关掉后整行不渲染 |
| `language` | `auto` | auto / zh / en | 文案语言；`auto` 依次读 `DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → 系统语言 |
| `intervalMs` | `10000` | 500–600000 | 轮换间隔（毫秒） |
| `typeSpeedMs` | `30` | 0–2000 | 打字机每字间隔；`0` = 整句直出 |
| `thinkingMs` | `15000` | 0–600000 | 「思考」阶段时长，超过进入「运行」 |
| `longAfterMs` | `60000` | 0–3600000 | 「长任务」阈值；小于 `thinkingMs` 时按 `thinkingMs` 处理 |
| `weightedRandom` | `true` | 开/关 | 按权重抽句；关掉为等概率 |
| `antiRepeatRecentLimit` | `3` | 0–50 | 洗牌袋跨袋记忆条数（0 = 只靠袋内不重复） |
| `labelSource` | `phrases` | phrases / host | `host` = 本插件完全让位，保持宿主原状 |
| `gradientEnabled` | `true` | 开/关 | 逐字流动渐变 |
| `gradientMode` | `theme` | theme / day / night | `theme` 用宿主主题色板（随深浅色自适应）；`day`/`night` 用下面两套自定义色板 |
| `gradientDirection` | `rtl` | rtl / ltr | 流光方向 |
| `gradientColors` | 原插件黑夜色板 | ≥2 个颜色 | 自定义色板（`#rrggbb`、`rgb()`、`ansi256()`、`ansi:name` 或宿主主题色名，逗号分隔） |
| `gradientDayColors` | 原插件白天色板 | ≥2 个颜色 | 自定义白天色板（`gradientMode=day` 时使用） |
| `gradientSpeedSec` | `4` | 1–60 | 渐变流动一圈的秒数 |

更复杂的结构（`presets` / `schedule` / `enabledPacks` / `bankPath`）不是声明式设置能编辑的，写进 profile 的插件行配置即可（见下一节），修改后重启宿主或热重载插件生效。

## 命令

```text
/status-rotator next      # 立刻换下一句
/status-rotator on|off    # 本次运行内开关（长期设置请到 /settings）
/status-rotator status    # 诊断：当前阶段/文案/词库包/宿主接缝/最近异常
```

命令通过 dsh-commands 注册；宿主有托管命令面（`tuiPluginHost.registerCommand`）时优先走托管面，以便归属与授权检查。

## 高级配置

在 `~/.dsh/profiles/dsh-tui/package.json` 对应 profile 的行配置里（或者该 profile 的 `cordis.patch.yml` 覆盖行里）追加：

```yaml
- id: status-rotator
  config:
    enabled: true
    intervalMs: 8000
    enabledPacks: [deepseek, coding, daily]   # 省略 = 默认 10 包；null = 全部；[] = 只用核心库
    activePreset: night
    presets:
      - id: night
        name: 夜间
        phrases:
          zh:
            thinking: ["正在进入深度摸鱼前摇…", "正在偷偷启动无畏契约…"]
            running: ["正在摸鱼但装作在推理…", "正在干完活偷偷写游戏…"]
            long: ["正在优雅地睡过整个 CI…"]
    schedule:
      - preset: night
        days: [1, 2, 3, 4, 5]     # ISO 星期 1=周一；省略 = 每天
        from: "22:00"
        to: "06:00"               # 支持跨零点
    bankPath: null                # null/省略 = ~/.dsh-tui/status-rotator/bank.json
```

- **预设**：命名的词库快照（可带自己的 `packs`/`enabledPacks`）；命中 `schedule` 时自动切换到该预设，离开时段回到 `activePreset`；
- **词库包**：`BUILTIN_PACKS` 共 14 个（`deepseek` / `coding` / `daily` / `internet-memes` / `sysadmin` / `slacking` / `math-physics` / `western-ai` / `reverse-proxy` / `china-ai` / `community` / `ads` / `star-ask` / `star-route`），默认启用前 10 个（945 条），全部 1362 条随包分发；
- **条件句 / 权重 / 稀有句**：词库条目支持 `{ text, weight, when, rarity }`（或字符串），`when` 支持 `tool` / `retry` / `pending` / `phase` / `hour` / `firstTurn`，条件命中的句子优先抽取；
- **占位符**：`{elapsed}` `{phase}` `{phaseLabel}` `{model}` `{provider}` `{tps}` `{pending}` `{tools}` `{running}` `{retry}` `{retryMax}` `{locale}` `{date}` `{time}`；随时间变化的占位符按控制器节拍实时刷新。

> 本文档里的示例文案均取自随包词库（14 个包、1362 条，原样移植；可用 `npm run check:bank` 或 `/status-rotator status` 核对），不是另写的演示文本；自定义预设/第三方注册示例里出现的文案同样来自这份词库。

### 外部词库（热重载）

把只写覆盖内容的 JSON 放到 `~/.dsh-tui/status-rotator/bank.json`（或用环境变量 `DSH_TUI_STATUS_ROTATOR_BANK`、行配置 `bankPath` 指定路径）：

```json
{
  "packs": [
    { "id": "china-ai", "phrases": { "zh": { "thinking": ["正在飞唐杰马…"] } } }
  ]
}
```

- 同 id 的包**整包替换**内置包，新 id 追加；`phrases` 覆盖核心库；只接受 `packs` / `phrases` / `enabledPacks`；
- 约 2 秒内检测文件变化并热应用，不用重启、不用重装；
- 文件损坏时保留上一次成功的词库并在 `/status-rotator status` 里报错；删除文件自动回落到内置词库。

### 从其他插件扩展

本插件在宿主上提供 `ctx.statusRotator` 服务（移植自 web 版同名接口），其他插件可以注册词库包、占位符和动态文案：

```js
export const inject = ['statusRotator']

export function apply(ctx) {
  const api = ctx.get('statusRotator', false)
  if (!api) return

  ctx.effect(() => api.registerPack({
    id: 'my-pack',
    label: { zh: '我的词库', en: 'My pack' },
    // 示例文案取自随包词库；实际注册时可以写任意文本
    phrases: { zh: { running: ['正在干完活偷偷写游戏…'] } },
  }))

  ctx.effect(() => api.registerPlaceholder('myState', () => '3 项'))

  ctx.effect(() => api.registerPhraseProvider(site => (
    site.phase === 'long' ? [{ text: '正在优雅地睡过整个 CI…', when: { phase: 'long' } }] : []
  )))
}
```

重复 id、占用内置占位符名、非函数 provider 都会**在注册时抛错**（不静默）；注册内容不进配置、不落盘，卸载即消失。`api.status()` 返回宿主接缝、词库包与诊断快照。

## 与原 web 插件的差异

移植保留了行为语义，但宿主换了，几项能力在终端里没有对应物，明确列出而不是悄悄简化：

| 原插件能力 | 本插件 | 说明 |
| --- | --- | --- |
| 阶段轮换（thinking / running / long） | ✅ 移植 | 数据源为宿主 `sessionProjections` 的 `workingActivity` 视图（与 dsh-TUI 自己的状态行同源），阶段切换立即换句 |
| 打字机、逐字出现 | ✅ 移植 | 由富状态视图本地动画驱动 |
| 运行数据源 | 🔁 适配 | web 版靠 DOM/宿主事件窗口；TUI 版靠宿主投影注册表（插件行与扩展行并发激活，注册用 `ctx.inject` 延迟到接缝可用） |
| 加权随机、洗牌袋反重复 | ✅ 移植 | 按「语言 + 阶段」分袋，跨袋记忆可调 |
| 词库包、按文本去重、条件句、稀有句 | ✅ 移植 | 14 包 1362 条原样随包 |
| 模板占位符 | ✅ 大部分移植 | `{pending}` 只统计审批（提问面板在 dsh-TUI 里不可从会话事件观测）；`{model}`/`{provider}` 在 TUI 宿主拿不到时显示 `—` |
| 预设与星期/时段调度 | ✅ 移植 | 配置写在插件行里 |
| 外部词库热重载 | ✅ 移植 | 路径改为 `~/.dsh-tui/status-rotator/bank.json` |
| 深浅色两套渐变 / 自动切换 | 🔁 适配 | dsh-TUI 不向富状态视图暴露当前主题名，默认改为「主题色板」渐变（宿主自动适配深浅色）；需要固定配色时用 `day`/`night` 自定义两套 |
| 逐字 CSS 渐变 / 字体 / 发光 / 呼吸 / 故障动画 | 🔁 适配 | 终端逐 cell 上色与宿主字体，不注入 CSS |
| 浏览器标签页标题轮换 | ❌ 不适用 | 无浏览器标签页 |
| 弹幕 / 鲸尾动画 / 外观主题画廊 | ❌ 不适用 | 终端状态行没有对应层；宿主自己的 working-activity 行负责这类装饰 |
| HTML 设置页 / HTTP + SSE 配置接口 | 🔁 适配 | 改用 dsh-TUI 原生 `/settings` 区块与 profile 配置；无 HTTP 端口 |
| `labelSource: host` | ✅ 移植 | 直接让位给宿主 |
| 第三方 `ctx.statusRotator` 注册接口 | ✅ 移植 | 注册包 / 占位符 / provider |

## 排障

先跑 `/status-rotator status`（宿主把命令结果压成一行，字段紧凑排列）：

```text
status-rotator on lang=zh phase=none ; view=on set=on settings=on cmd=on ;
sessions=1 proj=on/4 active=idle events=22/2 frames=4 packs=10 preset=none ; line=- errors=none
```

（上面为排版折行，实际是一行。）各字段含义：

- `view` 富状态视图已注册；`set` 纯文本降级接缝可用；`settings` /settings 区块已注册；`cmd` 命令已注册；
- `proj=on/N` 宿主投影数据源已挂接、已折叠 N 次变化；`events=a/b` 收到的 session/event 与 agent/status 数；
- `frames=N` 控制器发布的帧数；`phase`/`line` 当前文案快照；`errors` 最近两条诊断码。

- **整行不出现**：确认 `enabled=on`、`labelSource=phrases`，且当前有回合在跑（空闲时本插件不渲染）；
- **`view=off`**：宿主版本过旧或拒绝富状态视图；插件会退化为纯文本 `tuiStatus.set`（保留文案、无打字机/渐变），并在 `errors` 里写明；
- **`line=-` 且有 `bank.empty`**：检查 `enabledPacks` 是否把所有包都关了、词库文件是否被外部覆盖成空；
- **`proj=off` 且 `frames=0`**：宿主没有 `sessionProjections` 服务（非 dsh-TUI 宿主），阶段数据源缺失；诊断码 `host.no-session-projections`；
- **设置页没有「状态轮换」**：宿主缺少 `tuiSettingsSections` 接缝（诊断码 `host.missing-tuiSettingsSections`），仍可用行配置改参数；
- **Claude / Codex 后端下没有文案**：本插件的阶段引擎消费 DSH 会话投影；非 DSH 内核的会话流不产生 `workingActivity` 投影，本插件保持隐藏（不猜测状态）。这是宿主后端差异，不是轮换失败。

### 调试日志

界面上的「有没有」不够定位时，打开插件调试日志（只写 stderr / 显式文件，不在 stdout 输出）：

```sh
export DSH_TUI_STATUS_ROTATOR_DEBUG=1
# 可选：stderr 与 TUI 原始屏幕写入会互相穿插，指定文件更利于取证
export DSH_TUI_STATUS_ROTATOR_DEBUG_FILE=/tmp/sr-debug.log
```

会记录：接缝注册结果、projection 变化、session 事件类型、每次发布的帧（可见性/阶段/文案）。
真机回放样例见 [docs/real-tty-replay.md](./docs/real-tty-replay.md)。

## 开发与验证

```sh
npm install
npm run build          # tsc -> lib/types
npm test               # build + node --test test/
npm run check:manifest # dsh-plugin.json 离线形状检查
npm run check:bank     # 词库计数/查重/控制字符审计
npm run verify         # build + manifest + bank + 全部测试
npm run pack:verify    # npm pack 内容检查
```

真实宿主回放（无头断言不够）：

```sh
dsh plugin --profile dsh-tui add file:/绝对路径/dsh-tui-status-rotator
dsh --profile dsh-tui          # 发起回合，观察提示框上方的轮换行
/status-rotator status         # 核对接缝与词库
```

本次移植已在 dsh-TUI 0.16.1 真机上完成一次完整回放（装载、注册、逐帧渲染、
/settings 写回、隐藏收尾），记录见 [docs/real-tty-replay.md](./docs/real-tty-replay.md)；
验证口径与无头边界见 [docs/verification.md](./docs/verification.md)。

## 卸载与数据

- `disable`：只停用插件行，配置与数据保留；
- `remove`：移除包与行，**不删** `~/.dsh-tui/status-rotator/`（外部词库等用户数据）；清理报告只陈述宿主真正撤销了什么；
- 本插件的运行时资源（定时器、文件监听、状态视图、设置区块、命令、提供的服务）都挂在 cordis effect 上，卸载即释放，不残留。

## 许可与致谢

- 文案词库与行为规格移植自 [01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator)（MIT）；词条版权归原作者与投稿者所有；
- 宿主接缝与设计来自 [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)（MIT）；
- 本插件以 MIT 许可证发布，见 [LICENSE](./LICENSE)。
