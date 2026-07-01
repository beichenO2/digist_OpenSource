# digist 灵魂

> 信息摄取与消化引擎。Agent 修改本项目前，必须阅读并遵守以下核心特质。

---

## 核心特质

| 特质 | 与社区同类项目的差异 |
|------|----------------------|
| **多平台爬取** | 支持 arxiv/HN/reddit/github/bilibili/youtube/wechat 等多平台，API + Safari 双通道 |
| **融合引擎** | Louvain 社区检测 + 4 信号相关度模型，发现"惊人连接"和"Gap" |
| **视频消化三阶管道** | 字幕提取 → 音频 ASR → 完整下载，按需降级 |
| **高风险平台时间窗** | twitter/X、知乎强制走 Safari，抓取窗口限制在 01:00-07:00 |

---

## 外部合作

### 依赖

- [PolarPrivate](../PolarPrivate/PolarSoul.md)：LLM 摘要代理
- [KnowLever](../KnowLever/PolarSoul.md)：知识库推送

### 被依赖

- [Clock](../Clock/PolarSoul.md)：信息流 Feed
- [KnowLever](../KnowLever/PolarSoul.md)：内容来源

### 接口契约

- `/api/crawl/trigger`：触发爬取
- `/api/recommend`：内容推荐（4 信号评分排序）
- `/api/daily-report`：每日精选日报（LLM 精选 + 中文摘要，支持 `?force=1` 强制刷新）
- `/api/sources`：信息源 CRUD
- `/api/feedback`：结构化反馈

---

## 设计决策

### 日报精选与 LLM 摘要机制

**问题**：原始爬取每日 500+ 条内容，直接展示对用户是噪声。标题本身信息量低，需要基于正文内容做深度筛选和摘要。

**设计**：
1. **分类（keyword matching）**→ 按用户兴趣将内容分入 7 个 topic 组
2. **垃圾过滤（`isJunkBody`）**→ 识别并排除 HN comment dump、Reddit HTML 残渣等无实质内容条目
3. **LLM 精选（`curateTopic`）**→ 对每组有实质内容的条目，通过 DeepSeek Flash 精选 5 篇并生成中文摘要
4. **热点总结（`generateHotSummary`）**→ 从全量有正文的条目中提取 2-4 个深层趋势

**关键约束**：
- 摘要必须基于 `body_markdown` 正文提炼，不是翻译标题
- 每个分类最多 5 条精选（"其他" 分类 3 条），剩余丢弃
- LLM 调用顺序执行（非并发），避免 rate limit 导致批量 fallback
- Fallback 路径（LLM 不可用时）使用 `cleanBodyText()` 清洗后截取，仍优于原始标题

**不可妥协**：输出必须全中文；禁止出现 raw HTML/markdown/URL 残留。

### 为什么用三阶视频消化管道？

**问题**：视频下载耗时，字幕提取更快。

**决策**：
1. Phase 1：只提取字幕（--skip-download）
2. Phase 2：提取音频做 ASR
3. Phase 3：完整下载

**不可妥协**：默认优先字幕，避免不必要的下载。

### 为什么高风险平台有时间窗？

**问题**：twitter/X、知乎等平台有反爬机制，白天抓取风险高。

**决策**：强制走 Safari AppleScript（复用登录态），抓取窗口限制在 01:00-07:00（Asia/Shanghai）。

**不可妥协**：时间窗外不得抓取高风险平台。

---

## 详情入口

- [SSoT](polaris.json)
- [使用指南](README.md)
