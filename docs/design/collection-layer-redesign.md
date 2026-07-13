# digist 采集层重设计（免登优先 + Agentic 兜底）

> 状态：**草案 v1.1 · 评审反馈已并入** ｜ 作者：架构师 Agent（hub-agent-2）｜ 日期：2026-07-12
> 范围：**只推倒采集层**，保留存储 / digest / 推荐 / contracts / 3800 API（Clock 零改动）

## 变更记录
- **v1.1**（评审反馈）：
  1. **砍掉 L2 登录态层**（小红书/X/微博小号 Cookie）——从主线移除，降级为"暂缓，之后再看"（见附录 A）。理由：直接不碰强风控平台 = 零封号风险 + 零养号成本，正是最初"容易被封号"痛点的最彻底解法。
  2. **补充 L3 浏览器选型论证**（§4.1）——回答"GitHub 上很火的 AI 浏览器为什么不用"。
  3. 架构从三层收敛为**两层：L1 免登主干 + L3 Agentic 兜底（可选）**。
- **v1.0**：初版三层架构。

---

## 0. 一句话结论

当前 digist 用 AppleScript 把**你的日常 Safari** 变成采集傀儡（这才是"浏览器报废"的真因），逐站硬编码 selector、全串行、机械节奏。重设计收敛为两层：**能免登 API/RSS 就免登（主干，复用本机 agent-reach）**，只有免登但结构复杂/JS 重的站点才交给 **Agentic 反检测浏览器兜底**。**不接入任何需要登录态的强风控平台**——从根上消除封号风险和账号维护负担。

---

## 1. 问题定性（四大痛点根因，均有代码证据）

| 痛点 | 根因 | 证据 |
|---|---|---|
| **浏览器报废** | 采集主通道是 AppleScript 驱动 `Safari` 的 `window 1` 反复开关 tab、`do JavaScript` 抽 DOM，复用你日常登录会话，非独立 profile | `src/scrapers/safari-scraper.ts`（twitter/xhs/zhihu/bilibili/bloomberg 全走它）；Cookie 缓存 `./data/cookie-cache/{domain}.txt` |
| **适配一般** | 逐站硬编码 CSS selector，平台改版即断；Firecrawl 回退配置端口不一致（compose 暴露 3005，默认 URL 写 3002）从未真正接入 crawl 路由 | `safari-scraper.ts` selector；`firecrawl-scraper.ts` 未进 `crawl-api.ts` |
| **性能不好** | 全串行 + 平台间 5–10 分钟强制间隔，单轮 digest 推算 40–90 分钟；HN 逐条 fetch 评论；日报按 topic 顺序 await LLM | `scripts/daily-digest.sh`；`src/scheduler/smart-scheduler.ts`（30s stagger）；`src/report/daily-report.ts` |
| **易封号** | 同一 Safari 会话自动化 + 固定 12s 机械间隔；Twitter 号已封（已在代码禁用）；文档声称的"凌晨风险时间窗"在代码里已被清空、实际未生效 | `SAFARI_MIN_INTERVAL_MS` 默认 12s；`risk-window-policy.ts` `RISK_WINDOW_PLATFORMS` 为空集；`crawl-api` 未含 twitter |

---

## 2. 设计原则

1. **能免登就免登**：API / RSS / 官方开放接口优先，零封号风险、分钟级完成。
2. **不碰登录态**（v1.1 决策）：需要小号 Cookie 的强风控平台（小红书/X/微博）**当前不做**，避免封号风险与养号成本。相关方案保留在附录 A，未来需要时再启用。
3. **Agentic 是兜底，不是主干**：只在 L1 拿不到（免登但 JS 重/结构复杂）时启动，且跑在**与日常浏览器完全隔离**的反检测浏览器里。
4. **换引擎不换车身**：采集层输出仍是现有 `ContentItem` 类型，下游存储 / digest / 推荐 / 3800 API / Clock 全部不动。

---

## 3. 目标架构（两层）

```
                    ┌─────────────────────────────────────┐
                    │        Collector Router              │
                    │  platform → layer 路由               │
                    └───────────────┬─────────────────────┘
              ┌──────────────────────┴───────────────────────┐
              ▼                                               ▼
   ┌────────────────────────────┐              ┌──────────────────────────────┐
   │ L1 免登层（主干）          │              │ L3 Agentic 兜底层（可选）    │
   │ 零封号 · 分钟级 · 无需账号 │              │ 反检测浏览器 · 独立隔离      │
   ├────────────────────────────┤              ├──────────────────────────────┤
   │ arxiv     API              │              │ Camoufox（主）/ Patchright   │
   │ hackernews API             │              │ 独立 profile/指纹            │
   │ reddit    RSS              │  L1 拿不到   │ 仅免登但 JS 重/结构复杂站    │
   │ github    API              │ ───────────► │ LLM 定位元素 → 回写 selector │
   │ youtube   yt-dlp           │              │                              │
   │ v2ex      API              │              │ 触发：L1 失败 or 空结果      │
   │ bilibili  开放 API         │              │ 目标：bloomberg / 知乎游客 / │
   │ 公众号    wewe-rss         │              │       github trending 动态   │
   │ (复用本机 agent-reach)     │              │ 默认关闭，按需触发，控成本   │
   └─────────────┬──────────────┘              └───────────────┬──────────────┘
                 └─────────────────────┬─────────────────────────┘
                                       ▼
                        归一化 normalize() → ContentItem[]
                                       ▼
          ┌────────────────────────────────────────────────────────┐
          │  保留层（不改）：SQLite/FTS5 存储 · digest/推荐管线      │
          │  · contracts/ 契约 · 3800 API · web 仪表盘 · Clock 对接  │
          └────────────────────────────────────────────────────────┘
```

### 3.1 平台 → 层 路由表（v1.1）

| 平台 | 层 | 方式 | 现状 |
|---|---|---|---|
| arxiv | L1 | Atom API | 复用现成 `arxiv.ts` |
| hackernews | L1 | Firebase API（改批量，去掉逐条评论） | 优化现成 `hackernews.ts` |
| reddit | L1 | RSS | 复用现成 `reddit.ts` |
| github | L1 | 开放 API 替代 cheerio 爬 trending | 改造 `github.ts` |
| youtube | L1 | yt-dlp 元数据/字幕 | 复用现成 `youtube.ts` |
| v2ex | L1 | 官方 API（新增，agent-reach 有） | 新增 |
| bilibili | L1 | 开放 API（把主路径从 Safari 切过来） | `bilibili.ts` 已有 API，切主路径 |
| 公众号 | L1 | wewe-rss（替代现 WeRSS） | 评估替换 `wechat-rss.ts` |
| 知乎 | L3 | Agentic 免登游客态 | 兜底，非必需 |
| bloomberg | L3 | Agentic 提取（JS 重） | 兜底，非必需 |
| ~~小红书 / X / 微博~~ | ~~L2~~ | **暂缓**（见附录 A） | v1.1 移除 |

> agent-reach（本机已装，17 渠道，8 个零配置）作为 L1 的采集执行器复用，不再自己写 HTTP 爬虫。

### 3.2 统一采集接口（保持现有契约）

沿用 `src/types/index.ts` 的 `Scraper` 接口，新增一层 `LayeredCollector`：

```ts
interface CollectResult {
  items: ContentItem[]      // 复用现有类型，下游零改动
  layer: 'L1' | 'L3'        // 实际命中层，用于观测
  degraded: boolean         // 是否降级到兜底
  next_cursor?: string
}

interface PlatformStrategy {
  platform: string
  primary: LayerHandler          // L1
  fallback?: LayerHandler        // L3 Agentic（可选）
  selectorConfig?: SelectorSet   // L3 自愈回写目标
}
```

路由伪代码：`try primary(L1) → 空/异常 → 若配 fallback 则走 L3 → normalize() → 存储`。

---

## 4. L3 Agentic 兜底层设计

**定位**：不是主干，是"L1 打不开或结构变了"时的救火队 + 自愈器。仅服务**免登但难解析**的站点（bloomberg、知乎游客、动态渲染页），**不涉及登录态**。

- **浏览器**：见 §4.1 选型论证。**独立 profile 目录 + 独立指纹**，与你日常浏览器物理隔离——彻底解决"浏览器报废"。
- **自愈闭环**（解决"适配一般"）：
  1. selector 命中失败 → 截图 + DOM 快照喂给 LLM
  2. LLM 输出新的字段定位（选择器 / XPath / 语义锚点）
  3. 抽取成功后**回写 `selectorConfig`**，下次直接走快路径，不必每次调 LLM（控成本）
- **成本控制**：L3 默认关闭，仅按需触发；LLM 调用有日预算上限；自愈结果缓存复用。

### 4.1 浏览器选型论证（回应评审：为什么不用那些"很火的 AI 浏览器"）

评审提到 GitHub 上高星、号称"跨时代、CLI 友好"的 AI 浏览器。联网核实（星数为 2026-07 量级）后结论是：**它们大多不适合本地无人值守定时批采**，digist 的 L3 内核仍应选 **Camoufox（主）+ Patchright（备）**。原因分类如下：

| 类别 | 代表项目（星量级） | 为何不适合 L3 批采底座 |
|---|---|---|
| 消费者 AI 浏览器 | Perplexity Comet / Dia / OpenAI Atlas | GUI 产品、需登录会话、无稳定 headless API，会吃掉主力浏览器（重蹈覆辙） |
| LLM Agent 编排 | browser-use(~104k) / Stagehand(~23k) / Skyvern(~22k) / Suna(~20k) | 每页都烧 LLM，慢、贵、结果不可复现；内核仍是 Playwright/Chromium，本身不抗指纹 |
| MCP 控制面 | Playwright MCP(~35k) / Chrome DevTools MCP(~46k) | 给 IDE Agent 交互式用，不是定时批采 runtime |
| 新引擎 | Lightpanda(~31k, Zig) / vercel agent-browser(~38k, Rust) | 快、CLI 友好，但**指纹防护弱**，硬站易被识别；可作软站加速试点，非抗 bot 主力 |
| **反检测内核** | **Camoufox(~10k)** / **Patchright(~3.7k)** / nodriver(~4k) | ✅ 引擎级指纹注入、本地可脚本、独立浏览器实例——**正是 L3 需要的** |

**选型决策**：
- **L3 主**：Camoufox（Firefox 系，指纹防护最强，独立进程不占日常浏览器）
- **L3 备**：Patchright（Chromium 系，与 Playwright 生态兼容，作 Camoufox 打不开时的备用）
- **提取**：LLM 只做"元素定位/兜底解析"，不做全流程编排（控成本、保可复现）
- **排除理由**：digist 无人值守批采的真正瓶颈是**指纹与稳定性**，不是"用自然语言点网页"；高星 AI Agent 浏览器解决的是后者，且带来 $/页成本、延迟、AGPL 许可与云锁定问题。

---

## 5. 保留资产（不改，采集层新输出对接它们）

| 资产 | 文件 | 采集层如何对接 |
|---|---|---|
| 条目模型 | `src/types/index.ts` `ContentItem` + `src/normalizer/` | 新采集器输出 `ContentItem[]`，仍走 `normalize()`/`deduplicateByUrl()` |
| 存储 | `src/storage/index.ts`（FTS5 + 9 张表） | 仍调 `insertBatch/queryContent` |
| 契约 | `contracts/*.schema.json`（recommend-item/source-config/feedback/lobster-event） | source-config 驱动新采集器的源列表；输出满足 recommend-item |
| digest/推荐 | `src/report/daily-report.ts`、`src/normalizer`、Recommender | 零改动 |
| API | `src/api/server.ts`（约 40 条路由，含 `/api/crawl/trigger`） | `/api/crawl/trigger` 内部换成 LayeredCollector，**对外契约不变** |
| Clock 对接 | 3800 端口 + `/api/recommend`、`/api/daily-report` | **零改动**，Clock 无感知 |
| web 仪表盘 | `web/`（59 文件） | 零改动 |

---

## 6. 运行时稳定性修复（P0，已完成 ✅）

> 本节 2026-07-12 已执行并端到端验证，详见 §9 结论。

发现的**真正根因**（比初诊更深）：**PolarPort 端口漂移**。
- digist 的正确常驻方式是 `Start/start.sh` + PolarPort 动态端口分配。
- 但 PolarPort registry 里 `digist-api` 的 active 记录早已漂移到 8050（还残留 8005/8015/8020/8025/8045 一串），一旦规范重启 digist 就落到 8050。
- 而 Clock 前后端**硬编码 3800**（`Clock/backend/main.py` L283、`frontend/vite.config.ts` L111/133）。
- 此前之所以"看起来通"，是因为 16 个僵尸 server.ts 进程里恰好有一个占着 3800——**假性可用**。

修复动作：
1. 清理 12 个 server.ts 僵尸进程。
2. 释放 PolarPort 里 digist-api 全部陈旧 active 记录（8005/8015/8020/8025/8045/8050）。
3. `Start/start.sh` 重新拉起 → PolarPort 按 reserved preferred 分配回 **3800**。
4. 端到端验证：Clock backend(15550) → `/digist-api` 反代 → digist(3800)，`/api/health`、`/api/recommend` 全 200。

**遗留（独立项）**：KnowLever `:18080` 未启动，Clock 的报告编译链会 502（`/gw/knowlever-rag`）。这不影响 Feed/recommend，是否拉起 KnowLever 待定。

---

## 7. 迁移计划（v1.1，两层简化版）

| 阶段 | 内容 | 验证 | 状态 |
|---|---|---|---|
| **P0** | 运行时修复（端口漂移+僵尸+自启）| 3800 健康 + Clock 端到端 200 | ✅ 已完成 |
| **P1** | 搭 LayeredCollector 骨架 + L1 免登层全平台，统一 crawl-api/CLI/scheduler 路由 | typecheck + 5 套测试 + L1 全流程 QA + 实时 API 端到端 | ✅ 已完成（见 §13） |
| **P2** | L3 Agentic 兜底（patchright 独立 profile）+ LLM selector 自愈回写 | 故意破坏 selector，验证 LLM 自愈成功并回写 + 完整 daily-digest.sh 端到端 | ✅ 已完成（见 §14） |
| **P3** | bloomberg/zhihu 改 L3 为主（去 Safari）+ 串行调度改并行 | 单轮 digest 106s（旧串行 40–90min）+ 全量回归 | ✅ 已完成（见 §15） |

> L2 登录态层（原计划）已移除，见附录 A。
> **L3 浏览器选型修正**：设计原推荐 Camoufox，实现时改用 **patchright**——2026 年 Camoufox 虽有 `camoufox-js`（无需 Python）但仍需单独 fetch ~280MB Firefox 二进制、标 Experimental；patchright 是纯 Node 的 Playwright drop-in（Chromium 补丁），可复用本机已有 Chromium，工程可行性/CI 友好度更高，抗指纹也够用。Camoufox 保留为「Chromium 仍被拦时」的 L3-FF 升级项。

---

## 8. 需求锚点对齐（polaris.json）

- `[SSoT:digist/R1/多平台爬取与存储]`：采集层重写，输出契约不变 → R1 子功能需重新 test（当前全 not_tested）。
- R2/R3（分析融合、知识输出）、R4（仪表盘）、R5（user_id 隔离）：**不受采集层重构影响**，接口不变。
- 新增能力（分层采集、L3 Agentic 自愈）建议在 polaris.json 挂到 R1 下新 feature。

---

## 9. P0 验证结论（2026-07-12 实测）

| 检查项 | 结果 |
|---|---|
| digist `3800/api/health` | **200** |
| Clock→digist 端到端 `15550/digist-api/api/recommend` | **200** |
| Clock backend `15550/api/health` | 200 |
| PolarPort `digist-api` 唯一 active 记录 | **3800**（陈旧记录已清） |
| server.ts 僵尸进程 | 已从 12 清到 1 组 |
| KnowLever `18080` | 未监听（独立遗留项） |

---

## 附录 A：暂缓的 L2 登录态层（未来需要时再启用）

> v1.1 决策移除，保留资料。若未来要采集小红书/X/微博这类强风控平台，按此方案启用。

**核心约束**：只读、不发帖、不互动；**主力账号绝不接入**，只用专用小号。

### A.1 频率预算器
所有 L2 采集必过的统一中间件：日配额 + 最小间隔 + 随机抖动 + 强制串行 + 活跃时段 + 熔断。

| 平台 | 日配额 | 间隔+抖动 | 活跃窗 | 熔断 | 证据级 |
|---|---|---|---|---|---|
| 小红书 | 80–120 | 5–12s | 8–22 点 | 滑块/403/空包 → 停 24h | 间隔=社区共识；日配额=推断 |
| X | 200–800 帖读 | 15–45s | 8–22 点 | 429 → 睡 15–30min；连冻 → 停 48h | 社区共识 |
| 微博 | 60–150 | 3–10s | 8–22 点 | 432/Cookie 失效 → 停并换 Cookie | 有来源（RSSHub） |

### A.2 小号策略要点
- **小红书**：自注册不买号；养 7–21 天再采；Cookie 取 web 端 `a1`/`web_session`；同设备/IP 多号会连坐。
- **X**：优先评估**官方按量 API**（约 $0.005/帖读，个人用量几美元/月，最稳）；小号路线取 `auth_token`+`ct0`。
- **微博**：RSSHub 桥 + `SUB`/`SUBP` Cookie，失效快需定期重导。
- **IP**：个人家宽低频通常不必代理；机房 IP 登录态高危。
- **隔离**：多平台/多号独立浏览器 profile 或指纹环境。

---

## 13. P1 实施与验证结论（2026-07-13 实测）

### 13.1 交付内容
- **新增采集层骨架**：`src/collector/{types,registry,layered-collector,index}.ts`——LayeredCollector 统一「平台 → 层」路由，输出 `CollectResult{items,layer,degraded,...}`。
- **新增 L1 采集器**：`src/scrapers/v2ex.ts`（V2EX 免登开放 API，双域名 failover）。
- **改造 L1 采集器**：
  - `github.ts`：cheerio 爬 HTML → GitHub 官方 REST Search API（摆脱易碎 selector，可选 `GITHUB_TOKEN`）。
  - `hackernews.ts`：删逐条评论 fetch + 串行 → `Promise.all` 批量并发（15 条冒烟 1.2s）。
  - `bilibili`：主采集路径从 Safari DOM 切到开放 API（`bilibili.ts`）。
  - `reddit.ts`：加 15s 超时 + 失败返回空（不再拖垮整轮 digest）。
  - `wechat-rss.ts`：支持 `WEWE_RSS_URL`（wewe-rss）/`WERSS_URL` 双后端。
- **统一路由**：`crawl-api.ts`（对外契约不变，内部走 collect）、`cli.ts`、`scheduler/index.ts`（删除重复 SCRAPERS map，改走 collect + Firecrawl 兜底）三处入口统一。
- **契约/登记同步**：`types.platform` 加 `v2ex`；`server.ts` noQueryPlatforms 加 v2ex；`source-config.schema.json` platform enum 加 v2ex/wechat；`capabilities.json` 描述更新。
- **新增全流程 QA**：`tests/l1-collection.qa.ts`（`npm run test:l1`）。

### 13.2 验证结果（证据等级：自动化 + 人工 E2E）
| 验证项 | 结果 |
|---|---|
| `tsc --noEmit` 类型检查 | ✅ 0 错误 |
| test-edge / test-all / test-scrapers | ✅ 45 / 45 / 18 全通过 |
| contract.test / lobster-event.contract | ✅ 22 通过 / 0 失败 |
| **L1 全流程 QA**（注册→采集→归一化→去重→落库→幂等→推荐→对外契约）| ✅ 51–55 通过 / **0 失败** / 2–3 SKIP |
| 实时 API `/api/crawl/trigger`（v2ex/github/hackernews/bilibili/arxiv）| ✅ 均落库（scraped 9–20/条）|
| scheduler 经 collect 路径 | ✅ v2ex 9 / bilibili 20（API）/ arxiv 20 |
| Clock→digist 反代 `/api/recommend` | ✅ 200（Clock 零改动） |

### 13.3 已知边界（NOT RUN / 环境限制）
- **reddit**、**v2ex 主域名**：本机网络对 `reddit.com`、`www.v2ex.com` 有连通/证书限制 → 已做优雅降级（reddit 返回空不报错；v2ex 自动切 `global.v2ex.co` 镜像，实测可采到 9 条）。生产网络正常时 reddit 应恢复。
- **youtube**：依赖本机 `yt-dlp`，已装可采；未装则返回空（预期）。
- **wechat**：需 wewe-rss/WeRSS 部署，未部署时 SKIP（预期）。
- v2ex 单平台触发实测约 13s（主域名超时 6s + 镜像成功），已将超时从 10s×3 retry 收敛到 6s×1 retry×双域名。

## 14. P2 实施与验证结论（2026-07-13 实测）

### 14.1 交付内容
- **L3 骨架** `src/collector/l3/`：
  - `browser.ts`：patchright 反检测 Chromium，**独立 profile 目录**（`data/l3-profile/`）与日常浏览器物理隔离；lazy dynamic import（optionalDependency，主路径不加载）。
  - `healer.ts`：selector 失效 → 裁剪 DOM 喂 LLM（复用 `generateText`）→ 产出 SelectorSet → **cheerio 校验后才采信**（防幻觉）。
  - `selector-store.ts`：自愈结果持久化到 `data/selector-config/{platform}.json`（快路径复用，不重复调 LLM）。
  - `configs.ts`：bloomberg/zhihu 的 L3 配置 + seed selectors（对齐旧 Safari DOM 形状）。
  - `index.ts`：`createL3Handler`——「持久化 selector → seed → LLM 自愈」三级尝试，全程降级安全（patchright/LLM 不可用返回空不抛）。
- **接入**：`registry.ts` 给 bloomberg/zhihu 填 `fallback`（L1 空/异常 → L3）；CLI scrape 也路由 collect 享受兜底。
- **依赖**：`patchright` 作 optionalDependency 加入 package.json。
- **修复真实缺陷**：daily-report.ts / summarize-daily.ts 用了 PolarPrivate 不认的模型名 `xopdeepseekv4pro`/`qwen3-coder-plus` → 全 digest 摘要 422 失败。改为合法 QCSA 码（最终统一为 **`0000` = GLM-5.2，跨 xfyun + glm2 两条线负载均衡 50/50**；`DIGIST_SUMMARY_MODEL` 可覆盖）。**这是本轮 daily-digest 端到端跑出来的隐藏 bug。** 相关 PolarPrivate 侧改动（QCSA 0000/1000→GLM-5.2、新增 glm2 128K 线、双线 LB）在 PolarPrivate 仓。
- **新增 QA** `tests/l3-selfheal.qa.ts`（`npm run test:l3`）。

### 14.2 验证结果（证据等级：自动化 + 人工 E2E）
| 验证项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ 0 错误 |
| **L3 自愈 QA**（校验器/持久化/LLM自愈/真实浏览器捕获/端到端自愈）| ✅ 12 通过 / **0 失败** |
| L3 端到端自愈（真实 HN + 故意破坏 seed）| ✅ LLM 重新定位并回写，抽到 5 条，新 selector 持久化 |
| patchright 真实启动 Chromium | ✅ 复用本机 chromium，example.com/HN 均正常 |
| **完整 daily-digest.sh 端到端** | ✅ 采集 129 条 → summarize 6 域全部成功 → 写 digest.md（12KB 真实中文摘要）→ KnowLever 落盘 6 域 |
| daily-report / summarize 模型码修复后 | ✅ 无 422，6 域摘要均生成 |
| Clock→digist `/api/daily-report` 反代 | ✅ 200 |

### 14.3 已知边界
- **twitter/xiaohongshu/bloomberg/zhihu 的 Safari primary**：需 macOS Safari 登录态 + GUI，无人值守/CI 环境下 L1 会空 → 触发 L3 patchright 兜底（免登抓公开页）。daily-digest 端到端测试时按 `DIGIST_DISABLED_PLATFORMS` 禁用了这几个 Safari 平台以避免劫持 GUI。
- L3 首次对某平台自愈会调一次 LLM（数秒）；成功后 selector 持久化，后续走 cheerio 快路径。
- patchright 复用了本机 ms-playwright 的 chromium；纯净环境需 `npx patchright install chromium`。

## 15. P3 实施与验证结论（2026-07-13 实测）

### 15.1 交付内容
- **bloomberg / zhihu 去 Safari**：从「Safari primary + L3 fallback」改为 **L3 primary**（patchright 反检测浏览器 + LLM selector 自愈，无 Safari 依赖）。新增 `l3PrimaryStrategy()`（`src/collector/registry.ts`）。
- **twitter / xiaohongshu 彻底移除采集**（用户指令：强风控高封号风险，停止爬取）：从 `crawlPlatforms`、registry、CLI、smart-scheduler、daily-digest 全部删除；**`safari-scraper.ts` 文件已删除**；risk-window 默认禁用列表补 xiaohongshu 作安全网。
- **layer 标签修正**：`layered-collector.ts` 成功时改为读 `strategy.primary.layer`（原硬编码 'L1'），L3-primary 平台现正确标 L3。
- **safari-scraper 保留可回滚**：`safari-scraper.ts` 文件不删（twitter/xiaohongshu 仍用），只是 registry 不再把它作 bloomberg/zhihu 的 primary。
- **daily-digest.sh 并行化**：
  - Phase 1（L1 免登平台，互无风控关联）→ **并发**（`DIGIST_L1_CONCURRENCY` 默认 4），去掉逐平台 5 分钟串行 sleep。
  - Phase 2（bloomberg/zhihu=L3、xiaohongshu=Safari）→ **串行**（L3 profile / Safari 会话不可并发）。
  - LLM 摘要（summarize/curateTopic）保持串行（防打爆 PolarPrivate）。
- **CLI/scheduler**：`SAFARI_PLATFORMS` → `HEAVY_PLATFORMS`（仅调小 maxItems，语义更准）。

### 15.2 验证结果
| 验证项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ 0 错误 |
| 全量回归 test-edge/all/scrapers | ✅ 45 / 45 / 18 |
| contract / L3-QA / L1-QA | ✅ 22/0 · 12/0 · 56/0 |
| bloomberg/zhihu primary 层级 | ✅ 均为 L3（fallback=none） |
| bloomberg L3 真实采集 | ✅ patchright 打开成功（返回反爬提示页，机制通；生产可加 seed 优化） |
| **完整 daily-digest.sh（并行）** | ✅ 端到端 **90–210s**（多次采样区间），旧串行版本约 40–90 分钟。分解：Phase1 L1 并发采集 ~20–60s、Phase2 L3 串行(bloomberg+zhihu) ~15–70s、Phase3 摘要 ~55–80s |
| 单次 LLM 调用真实耗时 | ✅ 小请求 3–5s、日报规模(50 条/4000 token) ~25s（**确认真实调用上游，usage token 有回显**，非伪造/缓存） |
| daily-digest summarize | ✅ 0 个 422/报错（P2 修的模型码持续生效）；已改为域级并发（`DIGIST_SUMMARY_CONCURRENCY` 默认 2）进一步压缩 Phase3 |
| digist 3800 / Clock 反代 / PolarPrivate 12790 | ✅ 全 200 |

> 说明：早期报告写的「106s」是单次采样，实测区间是 90–210s（波动主要来自 zhihu L3 自愈耗时与 LLM 负载）；已如实修正，并非固定值。

### 15.3 已知边界
- bloomberg 首页对数据中心/自动化 IP 有反爬（返回 "unusual activity" 页），L3 机制本身正常；生产环境可换更稳的免登源或补 seed。
- zhihu 游客态无登录时内容有限，L3 采到 0 条属正常降级（不报错）。
- daily-digest 106s 中约 70s 是 LLM 摘要（6 域，串行防打爆），采集部分已从分钟级降到 ~35s。

## 16. 生产化：cron 定时 + bloomberg 换源（2026-07-13）

### 16.1 bloomberg → CNBC 官方 RSS（免登、零反爬）
bloomberg.com 及 RSSHub 公共实例的 bloomberg 路由都有强反爬（实测 rsshub.app/bloomberg/* HTTP 000），不适合无人值守。改为：
- 新增通用 RSS 采集器 `src/scrapers/rss-feed.ts`（`createRssFeedScraper`，解析 RSS 2.0 / Atom）。
- **bloomberg slot 改走 CNBC 官方 RSS**（top-news 100003114 + tech 19854910 + economy 20910258 + finance 10000664，各 30 条/feed，HTTP 200 稳定；初版曾误用重复 id，2026-07-13 修正为 4 路不重复 feed），`BLOOMBERG_RSS_URL` 可覆盖 feed。
- registry 中 bloomberg 从 L3 改为 **L1**（免登）；从 L3_REGISTRATIONS 移除（仅 zhihu 保留 L3）。
- daily-digest 中 bloomberg 从 Phase 2 移到 **Phase 1 并发**。
- 实测：`collect('bloomberg')` → L1，6 条真实 CNBC 条目，2.3s，无反爬。platform 仍标 `bloomberg`（digest slot 连续性），raw_metadata.source='cnbc' 如实标注真实来源。

### 16.2 daily-digest 排入 cron（生产化）
- 权威调度器 = **PolarProcess**（11055），SOTAgent（4800）bridge 转发、可见。
- `digist-daily-digest` 已注册并幂等确认：command `bash scripts/daily-digest.sh`、work_dir `~/Polarisor/digist`、cron **`0 6,8,11,14,17,20,23 * * *`**（每天 7 次）。PolarProcess cron 循环每分钟检查、按 cron_schedule 触发（不依赖 auto_start）。
- **裸环境可跑性已验证**：模拟 cron 的 `/bin/sh -c`、`env -i`（无 nvm PATH）跑完整 daily-digest → 退出 0、9 平台全 ✓、summarize 0 报错。关键：digist 有 `.nvmrc=22`，`ensure-node.sh` 在裸环境也能定位 node v22（解决 better-sqlite3 ABI）。
- **清理冗余**：`digist-summarize` 独立 cron 被禁用（cron 置 null）——它与 daily-digest 的 Phase 3 摘要重复，且其 command 指向失效的 node v20 路径会崩。

### 16.3 验证
| 项 | 结果 |
|---|---|
| bloomberg L1(CNBC RSS) 采集 | ✅ 6 条真实条目 / 2.3s / 无反爬 |
| 裸环境 cron 模拟完整 digest | ✅ 退出 0、9 平台 ✓、0 报错 |
| PolarProcess `digist-daily-digest` cron | ✅ `0 6,8,11,14,17,20,23 * * *` 已注册 |
| SOTAgent bridge 可见 | ✅ True |
| digist-summarize 冗余 cron | ✅ 已禁用 |

## 附：证据来源
- 代码事实：`digist/src/scrapers/*`、`src/api/*`、`src/storage/index.ts`、`contracts/*`、`polaris.json`、`Start/start.sh`、`Clock/backend/main.py`、`Clock/frontend/vite.config.ts`、`PolarPort/src/{registry,known-services,server}.ts`（本仓真实读取）
- 社区来源：RSSHub #20512 / PR#22319、wewe-rss、Folo、MediaCrawler #915、Stagehand/browser-use 对比（aicraftguide 2026）、反检测基准（ianlpaterson 2026）、Camoufox/Patchright/nodriver/Lightpanda GitHub、X API 2026（docs.x.com/socialcrawl）、小红书 AI 托管治理（21经济网 2026-03）
- P0 实测：主 Agent 亲跑命令（3800/15550 health、Clock 反代 recommend、PolarPort /api/list、ps/lsof/launchctl）
