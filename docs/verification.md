# 验证说明（dsh-tui-status-rotator）

本文件是这门插件的**可复现验证入口**，区分「无头可自动证明」与「必须在真实 TUI 里人工确认」
两部分。按 TUI Admission v0.15 的 evidence 分档，本仓库的无头门禁提供的是
`parsed`（manifest 被固定版本 parser 接受）+ `tested`（本包自己的测试与脚本）两档证据；
真实宿主里的渲染、设置写回、准入协商与清理观察属于 `observed` 档，只能在装了 dsh-TUI 的
终端里人工完成，见文末清单。

> 原则：无头测试全绿 ≠ 准入通过，也 ≠ 真实 TTY 里好看好用。两边的证据不能互相冒充。
>
> 2026-10-23：Lead 已在 dsh-TUI 0.16.1 真机上完成一次完整回放（装载、deferred 接缝注册、
> 逐帧渲染、/settings 写回、回合结束隐藏、卸载清理），原始命令与输出见
> [real-tty-replay.md](./real-tty-replay.md)。本文 §1 的 `node --test "test/**/*.test.ts"`
> 实际脚本带 `--test-concurrency=2`（并行负载下外部词库 watcher 用例会飘）。

---

## 1. 一键复现（Node 24，本机实测）

```sh
cd dsh-tui-status-rotator
npm install                # 只装 dev 依赖（@deepseek-ai/*、typescript）
npm run verify             # build + manifest/bank 审计 + 全部 node:test
npm run pack:verify        # npm pack --dry-run 产物面检查
```

`npm run verify` 等价于：

```sh
npm run build                                  # tsc -p tsconfig.json -> lib/types/
npm run check:manifest                         # scripts/check-manifest.mjs
npm run check:bank                             # scripts/check-bank.mjs
node --test "test/**/*.test.ts"                # 单元 + 集成测试
```

环境要求：Node `^22.19 || >=24`（依赖 Node 原生 TypeScript type-stripping，测试文件直接以
`.ts` 交给 `node --test`，不引入 vitest/jest）。本文件记录的结果来自 Node v24.21.0。

**注意**：测试全部 import `lib/types/**`（编译产物），不 import `src/**`。测试脚本本身带
`npm run build`，单独跑测试前也要先构建，否则会以「built plugin missing」失败。

### 1.1 各命令证明什么

| 命令 | 证明范围 | 不证明 |
| --- | --- | --- |
| `npm run build` | `src/**` 在 strict TS 下类型检查通过，产物落在 `lib/types/` | 运行时行为、宿主兼容 |
| `npm run check:manifest` | `dsh-plugin.json` 符合 Community v0.15 字段形状与 TUI Admission v0.15 政策（`TUI-PKG-001/002`）；与 `package.json`（version/name/files/`dsh.bundle.patch`）耦合正确；`facets.host.entry` 指向已构建的 `lib/types/index.js` | 真实 `@dsh-std/manifest` parser 与宿主 negotiation（见 §2） |
| `npm run check:bank` | 从 **BUILT** `lib/types/bank/data.js` 审计内建词库：14 包 / 1362 条 / zh746 / en616 / 默认 10 包 / 945 条；每包逐阶段计数；同阶段重复、控制字符、超长显示宽度、缺阶段、跨语言重复；`BUILTIN_BANK_SHA256` 复算一致 | 条件（`when`）在真实 live 上下文里的命中效果 |
| `node --test "test/**/*.test.ts"` | 引擎/词库/渲染/TUI 接缝单测 + **fake-host 集成测试**（见 §3） | 真实 React/Ink 渲染、真实宿主服务 |
| `npm run pack:verify` | `npm pack --dry-run` 的发布面：`lib/types/index.js(+.d.ts)`、`dsh-plugin.json`、`cordis.patch.yml`、README/README_ZH/LICENSE 都在；`test/`、`node_modules/`、`src/`、`scripts/`、source map 不外泄 | 依赖闭包/native build（本包无原生依赖） |

### 1.2 本机实测记录（2026-10-23；对应 src 最后修改 12:53:18 的工作树）

- `npm run build`：EXIT 0。
- `npm run verify`：EXIT 0，`tests 209 / pass 209 / fail 0`（数字随队友新增单测增长；含本文件
  作者负责的 5 条 fake-host 集成测试）；`check:manifest` 全 PASS；`check:bank` 0 error 0 warning。
- `npm run pack:verify`：EXIT 0，86 个文件（解包后约 0.43 MiB，随 docs 更新略变）入包，无
test/node_modules/src/scripts/source-map 泄漏；`docs/verification.md` 在包内。
- `check-bank` 关键数字与 `src/bank/data.ts` 注释一致：
  `total 1362 / zh 746 / en 616 / default 945 (69.4%)`；
  `sha256(JSON.stringify(BUILTIN_BANK_DOC)) = d6bbe22d…ae25` 与 `BUILTIN_BANK_SHA256` 完全一致。
- 构建产物一致性：37 个 `src/**/*.ts` → 74 个 `lib` 输出，0 缺失、0 过期（lib 内无 src 不存在的残留）；
  源文件最新 mtime 早于全部产物。`src/` 无 console.log/TODO 代码残留，无对 dsh-TUI 应用包或
  `@dsh-std/*` 的运行时 import（保持 host-agnostic，只依赖结构类型）。
- 已知偶发：`test/bank/external.test.ts` 的「2s watcher」用例依赖真实 `fs.watchFile` 轮询
  （单跑约 4.7s），在并行测试负载下有低概率超过其 6s 断言窗口；重跑即恢复。它与本插件
  TUI 行为无关，属测试时序脆弱，已报给 Lead。

### 1.3 脚本负例自检 + 词库移植保真

门禁脚本本身也做了负例验证（fixture 不随包发布，评审时手动复核）：

- `check-manifest.mjs`：9 个坏 manifest（`manifestVersion=0.14`、缺 `requires`、重复
  command id、optional 契约无 fallback、`requires.services` 非空、未知顶层 `provides`、
  未知权限名、`facets.host.entry` 指向不存在文件、`contributes.panels` 非空）全部
  **exit 1**，且报错定位到具体字段；正常 manifest 全 PASS。
- `check-bank.mjs` 的 `auditBank()`：8 种坏数据（控制字符、同阶段重复、超长、`weight=0`、
  未知 enabled pack、缺包、非法 pack id、未知 phase key）全部被识别为 error/warning；
  干净输入 0 error 0 warning。
- `pack-verify.mjs`：用故意把 `test/` 放进 `files` 白名单的临时工程验证——脚本识别
  “tarball does not ship test/” 并以 exit 1 结束；正常包全 PASS。
- **词库移植保真**：把 BUILT `lib/types/bank/data.js` 与上游 dsh-status-rotator 的
  `config.example.json` 逐条深比较（包顺序、label、zh/en × thinking/running/long 的每个
  词条及其 weight/when/rarity、enabledPacks、core phrases）：**1362 条全部逐字节等价，
  0 差异**。

---

## 2. Manifest 的真实 parser 复核（parsed 档）

`check-manifest.mjs` 是离线形状检查；准入还要求 manifest 能被**固定版本的
`@dsh-std/manifest`** 解析并投影。本机做了两次交叉复核（不进入 npm 包，仅作为证据）：

1. **宿主自带 parser（dsh-TUI 0.16.1 的 bundled `@dsh-std/manifest@0.1.0`）**：
   `parseManifest(source)` OK、`projectManifest(parsed)` OK；
   projected facet `name=host`、`protocols.requires=[commands.dsh/v1alpha1#Command]`、
   permissions 投影为 community Permission（action `commands.invoke`，scope 指向声明命令 id）。
2. **registry 上的更新 parser `@dsh-std/manifest@0.1.1-rc.3`**：同样 parse+project OK。

复核脚本（有 dsh-TUI 安装目录时手动跑一次即可，不需要进 CI）：

```sh
# DSH_TUI_PKG 指向已安装宿主包的 node_modules 目录（例如 npm 解包目录）
node --input-type=module -e '
import { readFileSync } from "node:fs"
const root = process.env.DSH_TUI_PKG
const mod = await import(root + "/@dsh-std/manifest/lib/index.js")
const src = readFileSync("dsh-plugin.json", "utf8")
const parsed = mod.parseManifest(src, { source: "dsh-plugin.json" })
const projected = mod.projectManifest(parsed)
console.log("PARSE/PROJECT OK", parsed.id, projected.spec.facets[0].name)
'
```

宿主侧的 negotiation / 五态准入（`compatible` / `compatible_degraded` /
`waiting_authorization` / `rejected` / `unknown`）由 dsh-TUI 的 admission loader 在真实
profile 里给出，属 observed 档，见 §4.1。

---

## 3. fake-host 集成测试覆盖了什么

文件：`test/integration/fake-host.test.ts`（node:test；import BUILT `lib/types/index.js`）。

用最小 fake cordis context（`get()` / `on()` / `effect()` / `logger` /
`fiber.entry.options.id` / `provide()`）挂 fake 的 `tuiStatus`、`tuiSettingsSections`、
`commands`、`tuiPluginHost` 服务，覆盖 5 组场景：

1. **富宿主全生命周期**：`apply()` 后
   - seam 11：`registerView` 恰好一次，`key="status-rotator"`、`maxRows=1`、identity 是插件
     ctx；用 fake React（`createElement/useState/useSyncExternalStore/useEffect`）+ fake
     `ui`（Box/Text/Image/`useTerminalSize`）渲染组件，隐藏帧返回 `null`，可见帧的
     element tree 包含当前文案；
   - seam 6：section `ns="status-rotator"`（跟随 `fiber.entry.options.id`）、
     15 个可编辑字段（path/kind/label/中英描述齐全，4 个 select 有选项）、`page.id` 正确；
   - 命令：走 mediated `tuiPluginHost.registerCommand`（不回落到直连），`status` 返回
     success 且输出包含 `view=on / set=on / settings=on / cmd=on`，`next/on/off` 生效，
     未知子命令返回 error；
   - 会话事件：`turn/start → assistant/chunk → tool/call → tool/result → turn/end` 驱动
     可见性；mock timers 推进 16s 后阶段从 `thinking` 进入 `running` 并重绘；
   - 生命周期：`ctx.effect` 清理执行，view/settings/command/service 的 disposer 全部运行，
     store 隐藏，**setInterval/clearInterval 计数归零**（无遗留 timer），`ctx.on` 监听随宿主
     scope 清空，无 `cleanup.failed` 诊断。
2. **降级：无 registerView**：只走 `tuiStatus.set` 纯文本，`status` 命令显示 `view=off
   set=on`，卸载时清空 key。
3. **降级：无 tuiPluginHost**：回落到直连 `commands.register`，命令仍可用，`settings=off`。
4. **裸 context**：所有接缝缺失时 `apply()` 不抛，逐项诊断可见，扩展 API 仍提供，卸载无泄漏。
5. **命名空间跟随 Loader row id**：`fiber.entry.options.id="custom-row"` 时 section ns/page
   都变成 `custom-row`。

fake-host 测试**不能**证明：真实 React reconciler/Ink-Yoga 布局、宿主真实服务的
revision-fenced 写入、权限 grant 判定、theme 颜色解析、TTY 宽度与真实动画节奏。

---

## 4. 无头不可验证 + 真实 TUI 人工清单（observed 档）

以下必须在装了 dsh-TUI 的终端里完成（建议用隔离 profile，别动日常 profile）：

```sh
# 1) 隔离 profile 里装宿主与插件（命令名以本机 dsh 为准）
dsh plugin --profile dsh-tui-verify add @deepseek-harness-tui/dsh-tui
dsh plugin --profile dsh-tui-verify add <本包路径或 tarball>

# 2) 启动 TUI（需要真实 TTY；无头环境只会得到不可信结论）
dsh --profile dsh-tui-verify
```

### 4.1 准入与安装面

- [ ] 插件安装/启用确认面板出现，且按 `TUI-RUN-002` 明示
      **trusted-in-process（进程内全信任、无沙箱）** 与声明的权限；不是只有文档里写了。
- [ ] 宿主日志/准入报告里该插件是 `compatible`（或明确列出 degraded 原因），
      manifest 被解析、facet `v1alpha1` 被接受、`commands.dsh/v1alpha1#Command` 协商成功。
- [ ] `/plugin` 授权矩阵能看到 `commands.invoke`（scope =
      `io.github.umamed26.dsh-tui-status-rotator.status-rotator`）。
- [ ] `disable → enable` 后插件恢复；`remove` 后行与 patch 生效面消失、用户数据保留；
      宿主只报告它实际撤销了什么（不出现「已清理干净」的假象）。

### 4.2 状态行渲染（seam 11）

- [ ] 空闲（无回合）时不占行、不闪、不抢焦点；开始回合后输入框上方出现轮换文案，
      1 行（`maxRows=1`），文案每 `intervalMs` 换一句，打字机按 `typeSpeedMs` 逐字出现。
- [ ] 阶段推进：turn 开始 ~15s 内为思考阶段，之后 running，超过 `longAfterMs` 进入 long
      阶段（默认 15s/60s；用 /settings 改小值更容易观察）。
- [ ] 渐变（`gradientEnabled=true`，默认 `gradientMode=theme`）跟随明暗主题变化；
      day/night 模式使用配置的调色板；`gradientDirection=rtl/ltr` 方向正确。
- [ ] 窄终端（如 40 列）下 CJK/emoji 按 2 cell 裁剪并出现省略号，不换行、不撑破 1 行；
      宽终端不裁断。
- [ ] 快速连发消息/工具调用时文案不闪烁跳变；工具名/重试/待批准等占位符与条件按原插件
      语义出现（可用 `{tool}`、`{elapsed}` 等含占位符的词条观察）。
- [ ] 隐藏/停用后不残留空行、不抢键盘输入、光标位置不变（重点看 `/status-rotator off`）。

### 4.3 命令与设置（seam 6）

- [ ] `/status-rotator status` 输出多行状态（启用、阶段、当前文案、词库包、宿主接缝
      view/set/settings/cmd、异常列表），且不破坏会话记录。
- [ ] `/status-rotator next|on|off` 生效；未知子命令报错可见；命令出现在补全/帮助里。
- [ ] `/settings` 里出现 `Status rotator` 区块/页，15 个字段可编辑（enabled/language/
      intervalMs/typeSpeedMs/thinkingMs/longAfterMs/weightedRandom/antiRepeatRecentLimit/
      labelSource/gradientEnabled/gradientMode/gradientDirection/gradientColors/
      gradientDayColors/gradientSpeedSec），中英文案正常。
- [ ] 保存后**不重启**即生效（loader volatile update 路径）：改 `intervalMs` 立刻变节奏，
      改 `enabled=false` 立刻隐藏，改语言立刻换语言；非法值（如负数、非颜色串）被宿主/插件
      拒绝并给出可见错误，而不是静默写坏配置。
- [ ] `/settings` 的保存/丢弃/回滚行为与其它插件一致；配置写入落在本插件命名空间
      （profile row id，默认 `status-rotator`），不污染其它插件的设置。

### 4.4 外部词库与异常可见性

- [ ] `~/.dsh-tui/status-rotator/bank.json`（或 `DSH_TUI_STATUS_ROTATOR_BANK` 指向的文件）
      存在时被热加载（约 2s 内），改文件后文案池变化；删除文件后退回内建词库。
- [ ] 写坏 JSON / 非法结构时保留上一份好词库，错误出现在 `/status-rotator status` 与
      宿主日志（异常显性，不静默）。
- [ ] 扩展 API 可用：其它插件 `ctx.statusRotator` 能 `registerPack/registerPlaceholder/
      registerPhraseProvider`，重复注册/覆盖内建占位符会明确报错而不是静默覆盖。

### 4.5 装卸与长跑

- [ ] 反复 `enable/disable`、`/status-rotator on/off` 若干次后，状态行行为稳定，无多行叠加、
      无残留 timer 造成的重绘抖动（可 `DSH_TUI_DEBUG=1` 看日志）。
- [ ] 长会话（>10 分钟、含长任务阶段）文案轮换正常，内存/CPU 无持续增长（观察宿主资源）。
- [ ] 卸载/禁用后（宿主 effect ledger 视角）不再有该插件的状态行写入、命令、设置区块或轮询；
      重新加载后干净恢复。

---

## 5. 结论口径

- 本仓库的无头门禁可复现 `parsed + tested` 证据：manifest 形状与真实 parser、词库规模与
  数据质量、构建产物面、以及 fake-host 下的接缝注册/渲染/命令/清理语义。
- 「在真实 TUI 里像原生一部分、不闪不抢焦点、/settings 写回、装卸干净」只能由 §4 的人工
  清单在真实宿主里确认；这些项目前的自动化替代物（fake React、fake 服务）是**回归护栏**，
  不是真实终端证据。
- 任何「已验证 / Verified」表述都必须绑定 std revision、profile、Host descriptor、artifact
  digest、suite 与结果（`TUI-CLAIM-001`）；本文件不宣称准入或 Verified。