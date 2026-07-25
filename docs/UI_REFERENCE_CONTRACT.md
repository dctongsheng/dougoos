# DougoOS UI 原型合同与视觉基线

- 任务：`ui-reference-001`
- 真源：
  - `prototypes/agentos/project/AgentOS SaaS.dc.html`
  - `prototypes/agentos/project/AgentOS Landing.dc.html`
  - `prototypes/agentos/project/support.js`（只用于解释原型运行语义）
  - `prototypes/agentos/README.md`（原型读取与真源边界）
- 生产边界：React/TypeScript 重建；禁止 iframe、原型 HTML 注入、加载或打包 `support.js`
- 数据模式：
  - `real-p0-p1`：本 Goal 内必须接真实 Core/ACP/本地展示偏好
  - `fixture-p2-plus`：保持原型画面和本地演示状态，不接超出本 Goal 的业务后端
  - `demo-only`：只有可见反馈，不发业务请求、不保存凭据、不声称能力上线

本文把原型源码转成可实施、可测量的合同。源码视觉输出仍是最终真源；本文不授权“设计优化”。

## 1. 原型运行语义

两份 `.dc.html` 都由 `support.js` 在浏览器中解释：

1. `<x-dc>` 内是模板，`<helmet>` 内容被挂入文档 `<head>`。
2. `sc-if` 按布尔值显示，`sc-for` 按数组顺序渲染。
3. `{{ value }}` 从 props 与 `Component.renderVals()` 的合并结果读取。
4. `style-hover`、`style-focus`、`style-active` 被编译为伪类规则，并强制 `!important`。
5. `data-dc-tpl` 是运行时生成的源码节点序号，只用于诊断，不是生产 DOM 合同。
6. `support.js` 从 unpkg 加载 React 18.3.1/ReactDOM 18.3.1，并从 Google Fonts 加载字体；视觉基线改由本地精确版本供应，杜绝网络漂移。
7. SaaS `componentDidMount()` 每秒调用 `tick()`。即使 `liveSim=false`，时钟、运行时长、token 和费用仍会变化；reference 捕获必须在脚本执行前冻结 Date、随机数和该 1000ms interval。
8. SaaS 的异步演示使用多个 `setTimeout`；Landing 只有本地 state 切换。

生产实现只复刻输出和交互，不复用上述运行时。

## 2. 全局视觉基础

### 2.1 字体

| 用途 | 字体栈 | 字重 |
|---|---|---|
| UI 正文 | `"Instrument Sans", "PingFang SC", "Microsoft YaHei", sans-serif` | 400/500/600/700 |
| 数值、路径、状态、代码 | `"JetBrains Mono", monospace` | 400/500/700 |

合同：

- reference 使用本地 `@fontsource/instrument-sans@5.3.0` 和 `@fontsource/jetbrains-mono@5.3.0` 的 latin woff2。
- 原型仍会声明 Google Fonts import；harness 阻断该 HTTPS 请求并以本地同名字体资源替代，其他外部请求一律视为失败。
- 中文继续走原型指定的系统 fallback。
- 截图前等待 `document.fonts.ready`，并分别断言两款字体 `document.fonts.check(...)`。
- 生产字体失败时必须落到上述固定 fallback，不能在首帧后换字造成布局跳变。

### 2.2 全局 CSS

- `* { box-sizing: border-box }`
- SaaS：`html, body` margin/padding 0、背景 `#0a0d0c`、`overflow:hidden`
- Landing：`html, body` margin/padding 0、背景 `#0a0d0c`
- 链接默认 `#3ddc84`，hover `#8df0b8`
- selection：`rgba(61,220,132,.25)`
- scrollbar：8px；thumb `rgba(140,160,150,.28)`；半径 4px；SaaS track 透明
- input placeholder（SaaS）：`#818f87`

### 2.3 Accent

| 名称 | 值 |
|---|---|
| green（默认） | `#3ddc84` |
| cyan | `#4fd8e0` |
| orange | `#ffb454` |
| purple | `#b48cff` |

Logo 背景统一为：

```css
linear-gradient(
  135deg,
  var(--accent),
  color-mix(in oklab, var(--accent) 55%, #0a0d0c)
)
```

Accent 会影响选中背景、focus ring、按钮、边框、图表末列、radial glow 和部分阴影。Agent 自身 hue 不随 accent 改变。

## 3. SaaS token 合同

### 3.1 Dark

| CSS 变量 | 值 |
|---|---|
| `--bg` | `#0a0d0c` |
| `--side` | `#0d1110` |
| `--top` | `rgba(13,17,16,.7)` |
| `--panel` | `#111614` |
| `--panel2` | `#141a17` |
| `--input` | `#121815` |
| `--code` | `#0a0f0d` |
| `--code2` | `rgba(0,0,0,.28)` |
| `--bd` | `rgba(255,255,255,.07)` |
| `--bd2` | `rgba(255,255,255,.12)` |
| `--text` | `#f2f7f3` |
| `--text2` | `#dfe8e2` |
| `--body` | `#c9d4cc` |
| `--mut` | `#8a968e` |
| `--faint` | `#66736b` |
| `--hov` | `rgba(255,255,255,.05)` |
| `--acFg` | accent 原值 |
| `--add` | `#7defb0` |
| `--del` | `#ff8892` |
| `--addBg` | `rgba(61,220,132,.07)` |
| `--delBg` | `rgba(255,95,107,.07)` |
| `--think` | `#4fd8e0` |
| `--wait` | `#ffb454` |
| `--idle` | `#5b6862` |
| `--dotOff` | `#39433e` |
| `--waitBody` | `#b8a68c` |
| `--bar` | `rgba(140,160,150,.25)` |
| `--glow` | `color-mix(in oklab, accent 5%, transparent)` |
| `--shadow` | `0 24px 60px rgba(0,0,0,.55)` |

### 3.2 Light

| CSS 变量 | 值 |
|---|---|
| `--bg` | `#eef1ee` |
| `--side` | `#f7f9f7` |
| `--top` | `rgba(247,249,247,.75)` |
| `--panel` | `#ffffff` |
| `--panel2` | `#f1f4f1` |
| `--input` | `#ffffff` |
| `--code` | `#f6f8f6` |
| `--code2` | `rgba(10,30,20,.045)` |
| `--bd` | `rgba(15,35,25,.1)` |
| `--bd2` | `rgba(15,35,25,.17)` |
| `--text` | `#141d17` |
| `--text2` | `#243029` |
| `--body` | `#37453c` |
| `--mut` | `#5f6d64` |
| `--faint` | `#84918a` |
| `--hov` | `rgba(15,35,25,.055)` |
| `--acFg` | `color-mix(in oklab, accent 55%, #0c4426)` |
| `--add` | `#15803d` |
| `--del` | `#c02636` |
| `--addBg` | `rgba(21,128,61,.08)` |
| `--delBg` | `rgba(192,38,54,.07)` |
| `--think` | `#0e7c8c` |
| `--wait` | `#a16207` |
| `--idle` | `#84918a` |
| `--dotOff` | `#c3ccc6` |
| `--waitBody` | `#7a6236` |
| `--bar` | `rgba(60,90,75,.18)` |
| `--glow` | `color-mix(in oklab, accent 8%, transparent)` |
| `--shadow` | `0 24px 60px rgba(30,50,40,.18)` |

### 3.3 固定布局

| 区域 | 合同 |
|---|---|
| App root | fixed inset 0；flex row；背景 `--bg` |
| Sidebar | 固定 240px；`--side`；右边 1px `--bd`；纵向 flex |
| Sidebar logo | padding `16px 16px 14px`；logo 28×28、radius 8 |
| Sidebar scroll | flex 1；`overflow-y:auto`；padding `4px 10px 10px`；gap 2 |
| Sidebar footer | padding `12px 14px`；顶部 1px `--bd` |
| Topbar | 高 54px；padding `0 20px`；gap 14；底边 1px；blur 10px |
| Main scroller | flex 1；min-height 0；`overflow-y:auto` |
| Main backdrop | `radial-gradient(900px 500px at 70% -10%, --glow, transparent 70%)` |
| Home | 内容 max-width 760px；中心布局；整体 `margin-top:-40px` |
| Dashboard / Memory | max-width 1240px；padding 20px |
| Agent | max-width 980px；height 100%；水平居中 |
| Cron / Queue / Settings | max-width 860px；padding 20px |
| Sessions Manager / Harness | max-width 1080px；padding 20px |
| Notification | absolute top 58px / right 16px；width 360px；z-index 900 |
| Home dropdowns | Agent min-width 230px；path min-width 220px；z-index 60 |

原型无 media query。1280×800 仍保持 240px sidebar；禁止擅自改成响应式卡片重排。计划要求的更窄 constrained sidebar 是生产扩展状态，不是原型 reference。

### 3.4 间距、边框、圆角与阴影

- 页面外边距主值：20px。
- 卡片间距主值：8/9/10/12/14/16px。
- 卡片 padding 主值：`11px 14px`、`13px 15px`、`14px 16px`、16px。
- 单行 nav：主 nav `8px 10px`；子 nav `7px 10px`。
- 边框：默认 1px `--bd`，交互/输入为 1px `--bd2`。
- 常见 radius：5/6/7/8/9/10/11/12/13/14/18/20px；pill 使用 999px 或 20px。
- Home composer：radius 18；shadow `--shadow`。
- Overlay：radius 12；shadow `--shadow`。
- Agent user bubble：`12px 12px 3px 12px`。
- Agent text bubble：`12px 12px 12px 3px`。
- 预算进度：高 5或6px，radius 3。
- toggle：36×20、radius 11；knob 14×14、top 2、left 2/19。

### 3.5 Z-index

| 元素 | z-index |
|---|---|
| 通知 overlay | 900 |
| Home Agent/path dropdown | 60 |
| Memory Galaxy 标题 | 3 |
| Memory star | 2 |
| Memory links svg | 1 |

生产新增 overlay 必须继续明确层级，不能盖住 approval 或使 composer 不可达。

### 3.6 动画与 transition

```css
@keyframes pulse {
  0%, 100% { opacity: 1 }
  50% { opacity: .35 }
}
@keyframes risein {
  from { opacity: 0; transform: translateY(4px) }
  to { opacity: 1; transform: none }
}
```

- `risein`：消息 180ms ease-out；dropdown 150ms ease-out；通知 160ms ease-out；Prompt 展开 150ms ease-out。
- 状态 dot：thinking 1.3s ease-in-out infinite；executing 2.2s；waiting 0.9s steps(1)；部分列表 live dot 1.6s。
- think 消息和 running 文案：pulse 1.4s ease-in-out infinite。
- 展开箭头和 toggle knob：150ms。
- card hover：边框 150ms，部分卡片上移 1px。
- hover/focus/active 必须保持原型声明；reference 将无限动画固定在 cycle start（0ms），并将有限入场动画和 transition 固定结算到终态；computed style 仍记录 animation name/duration/easing。

## 4. Landing token 与布局合同

Landing 使用一套独立 token，不能直接拿 SaaS light/dark 值替换。

### 4.1 Dark / Light

| 变量 | Dark | Light |
|---|---|---|
| `--bg` | `#0a0d0c` | `#f4f7f4` |
| `--panel` | `#0d1110` | `#ffffff` |
| `--side` | `#0c0f0e` | `#edf2ed` |
| `--text` | `#f2f7f3` | `#111b15` |
| `--text2` | `#dfe8e2` | `#223028` |
| `--mut` | `#8a968e` | `#5b6a61` |
| `--faint` | `#66736b` | `#7d8983` |
| `--bd` | `rgba(255,255,255,.08)` | `rgba(12,30,18,.1)` |
| `--bd2` | `rgba(255,255,255,.14)` | `rgba(12,30,18,.17)` |
| `--chip` | `rgba(255,255,255,.02)` | `rgba(12,30,18,.03)` |
| `--chip2` | `rgba(255,255,255,.03)` | `rgba(12,30,18,.05)` |
| `--inset` | `rgba(0,0,0,.28)` | `rgba(12,30,18,.05)` |
| `--winsh` | `rgba(0,0,0,.55)` | `rgba(30,50,38,.2)` |
| `--gridln` | `rgba(140,170,155,.05)` | `rgba(30,60,42,.07)` |
| `--memlab` | `#8a80b0` | `#6a5f95` |

### 4.2 Geometry

- 根：`min-height:100vh`，relative，`overflow-x:hidden`。
- Grid：48×48px；纵向 mask 在 70% 前淡出。
- Hero radial：top -180；centered；900×480；accent 14%。
- 主容器：max-width 1120px；margin auto；左右 padding 32px。
- Header：padding `22px 0`。
- Hero：padding `64px 0 40px`。
- H1：56px / 1.12 / 700；max-width 820px。
- Hero copy：17px / 1.65；max-width 600px。
- 产品窗口：radius 16；mini sidebar 200px；body min-height 420px。
- 产品窗口 shadow：`0 40px 120px --winsh, 0 0 0 6px --chip`。
- Features：3 列、gap 14；卡片 radius 14、padding 22。
- Routing / Memory：2 列、gap 48。
- Stats：4 列、gap 14。
- Login modal：380px；padding 28；radius 16；overlay z-index 100。
- 必测 viewport：1440×1000 与 1024×768；原型没有 breakpoint，1024 继续使用上述 grid。

### 4.3 Background 与动画

- 产品窗口内容 radial：`500px 260px at 70% -10%`，accent 6%。
- Memory card：紫色双层 radial。
- Login overlay：`rgba(4,8,6,.55)` + blur 6px。
- Landing pulse 与 SaaS相同。
- `drift`：0/100% translateY(0)，50% translateY(-8px)；7s ease-in-out infinite。

## 5. SaaS 信息架构与可达状态

### 5.1 Shell 与 Sidebar

| 区域 | 默认状态 | 可达状态 |
|---|---|---|
| 主导航 | Home active | Home、总览、任务编排、Memory |
| 任务编排 | 展开，badge 2 | 收起；定时任务；长程任务 |
| PROJECTS | 展开 | 整段收起 |
| 置顶 | 收起 | 展开 2 项 |
| 对话（内置项目） | 始终存在且展开 | 独立展开/收起；无历史 Session 时仍保留项目入口 |
| 目录项目 | 有历史 Session 的项目按最近顺序展示 | 每个项目独立展开/收起 |
| AGENTS | 展开 | 整段或每个 Agent 的 session tree 收起 |
| HARNESS | 展开 | 收起；8 子页 |
| SESSIONS MANAGER | 展开 | 收起；7 子页 |
| Sidebar scroll | top | bottom 边界 |
| Footer | 预算 78%、Ryo、Pro、6 agents linked | gear 打开 Settings |

通知 overlay 有 unread 和 all-read 两态。点击 Agent 通知会跳相应 Agent；“全部已读”只改本地 state。

### 5.2 Home

- 默认 manual、Claude Code、项目“对话”。
- manual/智能路由 segmented control。
- Agent dropdown：6 个 Agent、状态、dot；与 path dropdown 互斥。
- 项目 dropdown：第一项固定为“对话”，其后是最近使用过的目录项目与“选择其他项目目录…”。
- 4 个 suggestion 会填充 textarea。
- Prototype 发送：仅 Cmd/Ctrl+Enter 或圆形发送按钮。
- 智能路由使用前端 regex mock；发送后跳 Agent 页面并模拟消息。

#### 5.2.1 内置“对话”项目

“对话”是一个逻辑项目，不是把真实目录名改成中文后的展示别名。合同如下：

这是产品确认的 `production-only` 信息架构扩展；原型中的独立“对话/最近”树和裸 cwd
选择器只保留为 source evidence，不能覆盖以下生产合同。

1. “对话”始终存在，不依赖是否已有 Session；在 Sidebar `PROJECTS` 下默认展开。
2. Home 默认选择“对话”，选择器按钮和菜单项都只显示“对话”，不得显示其真实目录。
3. “对话”的 Session 直接列在该项目下，不再同时复制到独立的“最近/对话”树。
4. “对话”的真实目录只允许在 Settings 的“对话项目”区域查看和更改。Home 与
   Sidebar 不得把该路径写入可见文本、`title`、`aria-label` 或 `data-*` 展示属性。
5. Desktop 的系统默认值是 `join(app.getPath("documents"), "Dogoos")`，通常对应
   `~/Documents/Dogoos`；传给 Core/Provider 的值必须是展开后的绝对路径，不能传字面量
   `~`。
6. 修改目录只影响修改后从“对话”新建的 Session。已有 Session 保留创建时的 `cwd`；
   不迁移数据库记录，不重写历史 Session，不移动旧目录中的文件。
7. 普通目录项目仍以各自绝对 `cwd` 创建 Session；选择普通项目不得被“对话目录”的后续
   修改覆盖。

### 5.3 Dashboard / Cron / Queue

- Dashboard：4 KPI、6 Agent cards、3 queue preview、3 notification preview。
- Cron：4 行；3 on / 1 off；每行 toggle。
- Queue：2 queued、1 done；queued 可选 6 Agent 并派发；派发后 running，4.2s 后 done。

### 5.4 Agent 页面

| Agent | Session fixture | History | 独有 tab |
|---|---|---|---|
| Codex CLI | user/tool/text/tool/note | 2 | — |
| Claude Code | user/tool/tool/text/diff/approval | 2 | — |
| Grok CLI | user/think | 1 | — |
| Cursor CLI | user/tool/text/note | 1 | — |
| Pi | empty | empty | — |
| Hermes | empty | 1 | Skills、Kanban、MCPs |

七类视觉消息：

| 类型 | 原型样式 |
|---|---|
| user | 右对齐；max 82%；accent 14% panel；非对称 12px radius |
| text | 左对齐；max 86%；`--panel2` |
| note | JetBrains Mono 11px，`--mut` |
| think | `▚`；JetBrains Mono 11px；`--think` pulse |
| tool | max 86%；`--code`；tool 加粗；arg ellipsis |
| diff | max 92%；header + file/add/del；行级 add/del 背景 |
| approval | max 92%；wait 主题；command block；approve/reject 或 decided label |

Approval 必测 pending/approved/denied。approved 会追加 Bash tool，denied 会追加 note；两者同时标记通知为已读。

原型 History 的“↺ 恢复”只会把一条 note 追加到本地 fixture 并切回会话 tab。该画面是 `demo-only` / `capability-gated` reference；不得把它解释成 ACP 或 Core 已支持 resume/load，也不得在本 Goal 调用未协商的恢复接口。

Hermes 五个 tab 全部可达：

1. 对话
2. 历史
3. 技能（6 卡，可“运行”）
4. 看板（3 列）
5. MCPs（4 行）

### 5.5 Sessions Manager

1. Dashboard：4 KPI、7日活动、5来源。
2. Sessions：10 行；搜索支持标题/项目；empty state。
3. Insights：全部/摘要/决策/经验/技巧/Prompt质量；分类过滤。
4. Analytics：4 KPI、费用趋势、5模型 token。
5. Patterns：5 模式卡。
6. Export：4 format、3 depth、生成中、生成结果 note。
7. Cloud Sync：on/off、2 设备、立即同步与 syncing/刚刚。

### 5.6 Harness

1. System Prompt：6+1 legend、5 genome；任一 segment 展开片段。
2. Skills：6 卡。
3. MCP：5 server；开关态。
4. SubAgents：5 卡。
5. Goals：3 项与进度。
6. Workflows：3 条；running state。
7. Hooks：4 条；开关态。
8. Rules：4 卡。

### 5.7 Memory

- 图谱：14 stars、8 links，点击 star 跳最近/笔记并填 search。
- 最近：全部匹配项 list。
- 笔记：4 card。
- 记忆：10 omi list。
- 搜索匹配 title/body/project；no-match empty。

### 5.8 Settings 长页

视觉基线分 7 个 scroll slice：

1. Appearance。
2. 对话项目：显示当前目录并可调用 Electron 目录选择器更改。
3. Sidebar visibility / 界面自定义。
4. Agent configuration。
5. Usage + budget + notifications。
6. Projects。
7. Compare。

状态包括 dark/light、4 accents、对话目录、隐藏 sidebar item、6 Agent chip、model
选中、enabled、auto-approve demo、notification toggles、compare adopted。对话目录更新的
选择中、保存中、失败提示和取消选择均须可达；取消不得改变当前目录。

## 6. Landing 信息架构与状态

固定 section 顺序：

1. Header：brand、功能/Agents/Memory/文档、theme、登录/用户 pill、免费下载。
2. Hero：0.2.0 Early Access version chip、H1、copy、双 CTA、未公证提示与四步安装说明。
3. 漂浮产品窗口：traffic lights、mini sidebar、4 KPI、3 cards、composer。
4. 6 Agent chips。
5. Features heading + 6 cards。
6. Smart Routing 双栏 + 3 rows。
7. Memory 双栏 + galaxy。
8. Stats 4列。
9. Final CTA。
10. Footer。
11. Login overlay。

Landing 仅有以下真实原型事件：

- theme toggle：dark/light 本地 state。
- 登录按钮：打开 modal。
- 点击 overlay 背景或 close：关闭。
- modal 登录/GitHub/Google：直接切 logged-in presentation。

三个下载 CTA 是唯一批准的外部导航，必须统一指向
`https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg`，并明确标注未经
Apple 公证；其余 nav/CTA 都没有 handler，继续保持无副作用演示或明确 disabled。

## 7. 控件数据模式

### 7.1 `real-p0-p1`

| 控件/区域 | 合同 |
|---|---|
| Shell 连接状态 | 来自 Electron/Core；ready 前不能开放聊天 |
| Theme / accent | 本地非敏感展示偏好，可真实保存 |
| Claude Code/Codex provider 可用性 | `/api/providers` |
| cwd 选择 | Electron 目录选择 + shared/Core DTO |
| 内置“对话”项目 | 本地 Preferences + Core DTO；始终存在，Home 默认选中，真实目录只在 Settings 可见 |
| 对话目录修改 | Electron 目录选择；修改只作用于未来新建 Session，旧 Session 的 `cwd` 不变 |
| 新建 Claude/Codex session | Core API；只使用本 Goal 已约定的 create contract |
| 当前 Claude/Codex session 选择与展示 | Core API 的当前 session/snapshot；不等同于恢复历史进程 |
| Claude/Codex composer 发送 | shared/Core DTO 创建 Turn；发送态、busy 与错误来自真实 Core |
| 当前 Claude/Codex session 消息 | snapshot + ordered envelope |
| user/text/note/tool/diff/approval | shared DTO；不能有第二套 UI |
| real provider think | 本地 journal/snapshot 可保留协议事件，但 raw reasoning 不得进入 DOM、日志或持久化 UI 配置 |
| approval option | 只发服务端 optionId；一次性解决 |
| Turn Stop/cancel | 生产新增；幂等 Core API |
| busy/error/recovery | 生产新增；shared/Core 状态 |
| 相关通知 | approval、Turn completion 可由真实 P1 事件驱动 |

### 7.2 `fixture-p2-plus`

| 控件/区域 | 原因 |
|---|---|
| Home 智能路由 | P2 TaskRouter |
| Cron / long queue | P2/P7 编排 |
| Grok/Cursor/Pi/Hermes 页面与状态 | 本 Goal 只实现 Claude/Codex adapter |
| 原型中的 Claude/Codex/Grok/Cursor/Pi/Hermes History 列表与历史内容 | 固定 fixture；不是 Core session catalog，也不证明历史进程可恢复 |
| Dashboard 聚合 KPI/card fixture | P2+ 数据面 |
| Pinned / 普通目录项目 fixture tree | 外部 collector/项目管理后置；不包含真实的内置“对话”项目语义 |
| Sessions Manager 7 页 | P2/P5 |
| Harness 8 页 | P3/P6 |
| Memory 全页 | P7 |
| Usage/budget | 后续聚合/护栏 |
| Projects | 后续项目数据面 |
| Compare | P7 |
| Hermes Skills/Kanban/MCPs | Provider 特殊能力后置 |

Fixture 必须通过显式 DataSource；不得从组件内部用“如果没有 API 就 mock”的隐式分叉。

### 7.3 `demo-only`

| 控件/区域 | 强制边界 |
|---|---|
| Landing 登录/GitHub/Google/注册 | 不发认证请求，不保存邮箱/密码 |
| Landing nav/下载/在线体验/GitHub CTA | 无批准目标时无外部副作用 |
| Ryo/Profile/Pro | 纯展示，无账号体系 |
| Cloud Sync toggle/同步 | 不建账号、设备同步或快照上报 |
| Settings API Key/更换 | 不读写真实 secret |
| Settings 自动批准低风险操作 | 纯视觉；不得扩大 ADR-0003 默认询问策略 |
| Settings provider model/enabled UI | 原型状态展示；P1 只有 API provider availability/selection 是真实 |
| Export 生成结果 | 只生成演示 note，不写用户文件 |
| Workflow/Skill “运行” | 只跑原型 timer，不执行业务 |
| History “↺ 恢复”及恢复后的 note/session 画面 | `demo-only` 且 `capability-gated`；当前 Goal 禁止调用未协商的 resume/load API。只有 Core 明确发布 capability、shared contract 与失败语义后，才能另行接真实恢复 |
| Budget notification fixture | 不宣称真实计费 |

## 8. Fixture 固定合同

- Agent ids：`codex`、`claude`、`grok`、`cursor`、`pi`、`hermes`。
- Agent hues：
  - SaaS Codex `#4fd8e0`
  - Claude `#ff9d66`
  - Grok `#b48cff`
  - Cursor `#6aa5ff`
  - Pi `#49e0c0`
  - Hermes `#ffd166`
- 初始状态：Codex executing、Claude waiting、Grok thinking、Cursor executing、Pi/Hermes idle。
- SaaS 初始通知：Claude approval unread、Cursor done unread、budget read。
- 初始 queue：2 queued、1 done。
- Memory：14 条（10 omi、4 note），8 link。
- Settings projects：4。
- Compare：Claude/Codex/Grok 三列。
- Landing Agent glyph/hue 与 SaaS略有差异，必须按 Landing 自己的 `A` map 复刻，不能强行统一。

所有 reference 都冻结在 `2026-07-23T04:05:06.000Z`，时区 Asia/Shanghai，因此 Home greeting 是“下午好 · RYO”，clock 是 `12:05:06`。

## 9. 已确认的原型缺陷与合同冲突

### 9.1 Blank compare route

Sidebar 置顶“限流方案对比 · 3 agents”调用 `go({kind:'compare'})`，但模板没有 `isCompare` screen。结果只有 topbar 标题，main 空白。

- Manifest 保存一条 `source-defect` 证据。
- 它不进入生产 reference/actual pixel diff。
- Compare 的正常视觉真源是 Settings 底部 section。

### 9.2 Orphan view flags

`renderVals` 导出 `isUsage`、`isProjects`、`isCompare`，模板没有对应 DOM。Usage、Projects、Compare 都只在 Settings 长页出现。

### 9.3 Composer 键盘冲突

| 区域 | 原型 | `plan.md` 目标 |
|---|---|---|
| Home textarea | Cmd/Ctrl+Enter send；普通 Enter 换行 | P2+ fixture，可保留原型 |
| Agent input | 单行 input；Enter send；Shift+Enter 也会 send | Enter send；Shift+Enter 换行 |

生产 P1 应满足计划交互合同，使用可多行 composer，但默认静态截图尺寸/样式必须匹配原型。该行为差异必须有键盘测试，不能悄悄保留原型 bug。

### 9.4 原型缺少的 P0/P1 状态

原型没有：

- Core starting / migration error
- provider probing / unavailable
- Stop / running / cancelling
- structured API error / ACP error / crashed
- SSE reconnect / REPLAY_GAP / Core restart
- interrupted
- capability warning
- SESSION_BUSY
- 1024 constrained sidebar

这些列为 `production-only` case，采用相同 token/组件语言，不能伪造 prototype screenshot。
它们保存 production actual screenshot 与 metadata，但不生成虚假的 prototype reference/diff。
每个 case 必须声明并通过语义断言、landmark、真实 request/storage 拦截和预期 command effect。

### 9.5 安全冲突

Settings 的“自动批准低风险操作”与 ADR 的“默认永远询问，不能静默扩大权限”冲突。生产只能保留 demo-only 画面，不能让 toggle 改变 permission policy。

Landing 登录、Cloud Sync、API Key 同理：可见结构必须复刻，但不能接真实账号、同步或 secret 存储。

### 9.6 文案边界

Landing 原型写“你的会话数据永远不离开你的机器”，架构允许未来严格 allowlist 的伪匿名 metrics。生产发布前应由产品确认文案；本任务不改原型 reference。

### 9.7 内置“对话”项目与原型树冲突

原型把目录项目和“对话/最近”渲染为两棵树，并在 Home 直接展示 cwd。生产合同已明确改为：
“对话”是 `PROJECTS` 下始终存在的内置项目，Home 只显示逻辑名称，真实目录只在
Settings 可见。

- 不修改或重录原型 source reference 来伪造一致。
- 为 Home 默认“对话”、空对话项目、Sidebar 展开态和 Settings 目录状态增加独立
  `production-only` case。
- 语义断言必须确认 Home/Sidebar DOM 不包含对话真实路径，而 Settings 可以读取该路径。
- 目录修改回归必须确认只有后续新 Session 使用新 `cwd`，已有 Session 和旧目录文件不变。

## 10. 视觉 case manifest

机器真源：

- `tests/visual/visual-manifest.ts`
- 生成后的 `tests/visual/reference/manifest.resolved.json`

覆盖规则：

1. 默认 dark + green 的每个 page/subview 同时覆盖 SaaS 1440×900、1280×800；Landing 1440×1000、1024×768。
2. light + green、dark + cyan/orange/purple 在 SaaS Home、Claude conversation、Landing full page 两个标准 viewport 覆盖。
3. 每个独立 overlay/filter/toggle/async/empty/approved/denied/collapsed 状态至少一个 reference。
4. Hover/focus/active primitive 有独立 case。
5. Landing full-page screenshot 覆盖全部 section；modal 使用 viewport screenshot。
6. source defect 与 production-only case 分开，不参与正常 prototype→production diff。
7. SaaS production actual/diff evidence 已完成；Landing 仍明确 pending `landing-ui-001`。
8. 140 个 prototype-reference case 从正式 `apps/web/dist/site` 捕获；15 个 SaaS
   production-only case 使用隔离的 `apps/web/dist/visual-site` 驱动。visual case ID、query
   parser 和 fixture 不得进入 release bundle。
9. Metadata 分别记录 release/visual-test build hash、语义检查、landmark、真实
   request/storage 和经过清理的 command effect；不得记录 bearer token、prompt、cwd 或原始业务 body。
10. 历史 case ID `saas-production-seven-message-types` 只使用安全固定 fixture 展示七类
    视觉消息；它不代表 real Provider reasoning 可见。real mode 由独立 DOM 隐私断言确认
    raw `think` 不可见。

阈值来自计划：

- geometry ≤ 1px
- 每颜色通道 ≤ 1
- diff pixel ratio ≤ 0.5%
- SSIM ≥ 0.995

## 11. Deterministic reference 捕获

命令：

```bash
pnpm visual:references
pnpm visual:references:check
pnpm test:visual
```

捕获合同：

- Playwright `@playwright/test@1.61.1` bundled Chromium
- device scale factor 1
- locale `zh-CN`
- timezone `Asia/Shanghai`
- fixed Date `2026-07-23T04:05:06.000Z`
- seeded `Math.random`：`1597463007`
- 在 `support.js` 前抑制 1000ms interval
- React/ReactDOM 18.3.1 从本地 test-only asset 提供
- Instrument Sans / JetBrains Mono 5.3.0 从本地 woff2 提供
- 外部 HTTPS 全部阻断；出现任何外部请求即失败
- fonts ready + explicit check
- caret 隐藏
- scroll 由 manifest 固定
- 无限 CSS animation 在 cycle start（0ms）暂停采样；有限 animation / transition 结算到终态
- 每 case 保存 PNG、viewport/runtime 元数据、关键 landmark computed style/bounding box、全可见 DOM geometry/style digest
- 每 case 的 `sourceSha256` 覆盖对应 `.dc.html` 与 test-only `support.js` 的有序组合，避免 runtime 支撑脚本变化后沿用旧证据
- 先做一遍完整 warmup，再执行两次计量 capture；图片必须同时满足 channel tolerance、diff ratio 与 SSIM 门禁
- metadata 文件保留完整字段；比较时只排除由 PNG 本身派生的 `screenshot.bytes` / `screenshot.sha256`，其余 DOM digest、字体、网络、文案、computed style 需一致，document/landmark geometry 允许最多 1px
- 每次稳定性检查打印 hash-different case、最差 diff pixel ratio、raw max channel delta、landmark semantic computed-color channel delta、最小 SSIM 与最大 landmark geometry delta；raw raster edge 可超过 1，但 semantic computed color 必须 ≤ 1
- committed check 同时验证 `run.json`、`manifest.resolved.json`、完整 case id 集及 reference 目录没有 stale PNG/metadata；这些 evidence 任何一项漂移都失败

reference 目录：

```text
tests/visual/reference/
├─ screenshots/<case>.png
├─ metadata/<case>.json
├─ manifest.resolved.json
└─ run.json
```

## 12. 生产复刻交接规则

1. 不修改 `prototypes/`。
2. 不 import、copy 或打包 `support.js`。
3. 不把 `.dc.html` 直接放入 DOM。
4. 页面结构、文案和 token 先逐页匹配 reference，再接 DataSource。
5. Claude/Codex 真实数据替换 fixture 时，不改变消息 DOM 的视觉输出。
6. P2+ fixture 与 demo-only action 禁止发业务 API。
7. 动态状态新增 screenshot case 后，才能宣称 UI DoD。
8. 每个 production case 最终保存 reference/actual/diff/metadata；没有 prototype source 的状态只保存 token-consistent actual 与独立产品断言。
