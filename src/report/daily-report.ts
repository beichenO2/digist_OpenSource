/**
 * Daily report generator — topic-grouped, rolling update.
 *
 * Structure:
 *   1. Hot Topics Summary (LLM-generated, DeepSeek Pro via PolarPrivate)
 *   2. Topic clusters (grouped by interest, de-titled, source as suffix link)
 *   3. Rolling timeline stats (collapsible)
 *
 * Cron pre-generates at 00:05, 08:00, 12:00, 20:00.
 */
import cron from 'node-cron';
import { Storage } from '../storage/index.js';
import { generateText, isLlamaServerAvailable } from '../utils/local-llm.js';
import type { ContentItem } from '../types/index.js';

interface TopicCluster {
  topic: string;
  items: { fact: string; url: string; platform: string }[];
  count: number;
}

interface DailyReport {
  date: string;
  generatedAt: string;
  totalItems: number;
  topicCount: number;
  hotSummary: string;
  clusters: TopicCluster[];
  recentCount: number;
  markdown: string;
}

const ALL_PLATFORMS = [
  'hackernews', 'arxiv', 'reddit', 'twitter', 'bilibili',
  'xiaohongshu', 'zhihu', 'bloomberg', 'github', 'youtube', 'wechat',
];

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

function platformShort(p: string): string {
  const map: Record<string, string> = {
    hackernews: 'HN', arxiv: 'arXiv', reddit: 'Reddit', twitter: 'X',
    bilibili: 'B站', xiaohongshu: '小红书', zhihu: '知乎',
    bloomberg: 'BBG', github: 'GH', youtube: 'YT', wechat: '微信',
  };
  return map[p] || p;
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  'Agent': ['agent', 'mcp', 'tool use', 'function call', 'agentic', 'autonomous', 'multi-agent', 'langchain', 'autogen', 'crewai'],
  'CV（机器视觉）': ['vision', 'image', 'video', 'visual', 'detection', 'segmentation', 'diffusion', 'generative', 'stable diffusion', 'midjourney', 'opencv', 'yolo'],
  'LLM基础算法': ['transformer', 'attention', 'llm', 'language model', 'gpt', 'claude', 'gemini', 'qwen', 'deepseek', 'inference', 'training', 'fine-tun', 'rlhf', 'rag', 'embedding', 'tokeniz'],
  '加密货币': ['crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'defi', 'stablecoin', 'blockchain', 'web3', 'solana', 'token', 'exchange', '加密', 'nft'],
  '量化金融': ['quant', 'trading', 'hedge fund', 'algorithmic', 'backtest', 'portfolio', 'alpha', 'factor', 'sharpe', 'futures', '量化', 'hft', 'market making'],
  '重大金融事件': ['fed', 'interest rate', 'inflation', 'gdp', 'earnings', 'ipo', 'merger', 'acquisition', 'regulation', 'sec', 'tariff', 'recession', 'layoff', 'market crash'],
};

function groupByTopic(items: ContentItem[], interests: { label: string; query: string }[]): Map<string, ContentItem[]> {
  const groups = new Map<string, ContentItem[]>();

  const topicList = interests.map(i => {
    const builtinKw = TOPIC_KEYWORDS[i.label] || [];
    const queryKw = i.query.toLowerCase().split(/[,，\s]+/).filter(Boolean);
    return { label: i.label, keywords: [...new Set([...builtinKw, ...queryKw])] };
  });

  for (const item of items) {
    let matched = false;
    const text = `${item.title} ${item.body_markdown}`.toLowerCase();

    for (const topic of topicList) {
      if (topic.keywords.some(kw => text.includes(kw))) {
        const list = groups.get(topic.label) || [];
        list.push(item);
        groups.set(topic.label, list);
        matched = true;
        break;
      }
    }

    if (!matched) {
      const list = groups.get('其他') || [];
      list.push(item);
      groups.set('其他', list);
    }
  }

  return groups;
}

function deTitle(title: string): string {
  return title
    .replace(/^(Show HN|Ask HN|Tell HN|Launch HN):\s*/i, '')
    .replace(/[!！？?]+$/, '')
    .replace(/^["「『]|["」』]$/g, '')
    .trim();
}

interface CuratedItem {
  summary: string;
  url: string;
  platform: string;
}

/**
 * For a topic cluster, send items (with body) to LLM to:
 * 1. Score quality/information density
 * 2. Select top N best items
 * 3. Produce a Chinese 1-2 sentence summary for each
 */
function cleanBodyText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/&x[0-9a-fA-F]+;/g, ' ')
    .replace(/&#x[0-9a-fA-F]+;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[#*_~`>|]/g, '')
    .replace(/^Link\b.*$/gm, '')
    .replace(/^---\s*$/gm, '')
    .replace(/Top Comments\s*/g, '')
    .replace(/\b\w+:\s*$/gm, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isJunkBody(body: string): boolean {
  const head = body.slice(0, 300);
  if (/^Link\s/i.test(head)) return true;
  if (/Top Comments/i.test(head)) return true;
  if (/&x2F;/i.test(head)) return true;
  if (/<!-- SCOFF/i.test(head)) return true;
  if (/<div class=/i.test(head)) return true;
  if (/&quot;/i.test(head) && /&lt;/i.test(head)) return true;
  if (/<table[\s>]/i.test(head)) return true;
  return false;
}

function hasSubstantiveContent(it: ContentItem): boolean {
  const raw = it.body_markdown || '';
  if (raw.length < 30) return false;
  if (isJunkBody(raw)) return false;
  const body = cleanBodyText(raw);
  if (body.length < 40) return false;
  return true;
}

function fallbackSummary(it: ContentItem): string {
  const body = cleanBodyText(it.body_markdown || '').slice(0, 200);
  if (body.length > 50) return body.slice(0, 150);
  return deTitle(it.title);
}

async function curateTopic(
  topicLabel: string,
  items: ContentItem[],
  selectN: number = 5,
): Promise<CuratedItem[]> {
  const substantive = items.filter(hasSubstantiveContent);
  const pool = substantive.length >= selectN ? substantive : items;

  const available = await isLlamaServerAvailable();
  if (!available) {
    return pool.slice(0, selectN).map(it => ({
      summary: fallbackSummary(it),
      url: it.source_url,
      platform: it.platform,
    }));
  }

  const maxItems = Math.min(15, pool.length);
  const candidates = pool.slice(0, maxItems).map((it, idx) => {
    const body = cleanBodyText(it.body_markdown || '').slice(0, 400);
    return `[${idx + 1}] ${it.title}\n${body || '(无正文)'}`;
  });

  if (candidates.length === 0) return [];

  const prompt = `你是信息分析师。以下是「${topicLabel}」主题下的 ${candidates.length} 篇文章。

任务：
1. 只选与「${topicLabel}」主题真正相关的文章（不相关的跳过）
2. 从相关文章中精选 ${Math.min(selectN, candidates.length)} 篇信息量最大的
3. 对每篇精选文章，用中文写 1-2 句话概括**核心洞察/方法/策略/结论**
4. 排除纯营销、无实质内容、与主题不相关的文章

规则：
- summary 必须是中文
- summary 的重点是"有什么用/怎么做到的/结论是什么"，而非"谁发布了什么"
- 量化策略类：必须说明具体策略/因子是什么、在什么尺度交易、取得了什么成果
- 技术方法类：必须说明用了什么方法解决了什么问题、效果如何
- 不要写"介绍了XXX"、"提出了XXX"这样的叙事句；直接说XXX是什么、做了什么
- 如果只有标题没有正文，基于标题翻译+浓缩为中文要点即可（不要原样复制英文标题）

输出格式（严格 JSON 数组，无其他内容）：
[{"idx": 1, "summary": "中文要点概括..."}, ...]

文章列表：
${candidates.join('\n\n')}`;

  try {
    const resp = await generateText(prompt, {
      capability: '0000',
      maxTokens: 800,
      temperature: 0.3,
      system: '你是一个严格的信息筛选器。只输出 JSON 数组，不输出其他任何文字。用简洁的中文概括核心洞察，重点是"是什么/怎么做/结果如何"，避免描述性叙事。',
    });

    const jsonMatch = resp.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return pool.slice(0, selectN).map(it => ({
        summary: fallbackSummary(it),
        url: it.source_url,
        platform: it.platform,
      }));
    }

    const parsed = JSON.parse(jsonMatch[0]) as { idx: number; summary: string }[];
    return parsed.slice(0, selectN).map(p => {
      const item = pool[p.idx - 1];
      if (!item) return null;
      return {
        summary: p.summary || fallbackSummary(item),
        url: item.source_url,
        platform: item.platform,
      };
    }).filter(Boolean) as CuratedItem[];
  } catch (err) {
    console.error(`[DailyReport] curateTopic(${topicLabel}) failed:`, err);
    return pool.slice(0, selectN).map(it => ({
      summary: fallbackSummary(it),
      url: it.source_url,
      platform: it.platform,
    }));
  }
}

async function generateHotSummary(items: ContentItem[]): Promise<string> {
  const available = await isLlamaServerAvailable();
  if (!available) {
    return '_（PolarPrivate 未运行，热点总结暂不可用）_';
  }

  const richItems = items
    .filter(hasSubstantiveContent)
    .slice(0, 25)
    .map(it => `- ${it.title}: ${cleanBodyText(it.body_markdown || '').slice(0, 150)}`);

  if (richItems.length < 3) {
    return '_（今日有正文的条目过少，暂无热点总结）_';
  }

  const prompt = `以下是今日从多个信息源采集的 ${richItems.length} 条内容（含正文摘要）。

请分析这些内容，提取 2-4 个深层趋势/热点，要求：
1. 不要列举具体文章名，要提炼背后的趋势和原因
2. 格式："{领域/现象}：{为什么会出现这个趋势，本质原因是什么}"
3. 用中文，简洁直接，每个热点 1-2 句话

内容列表：
${richItems.join('\n')}`;

  try {
    const resp = await generateText(prompt, {
      capability: '0000',
      maxTokens: 600,
      temperature: 0.4,
      system: '你是一个信息分析师，擅长从大量信息中提取有意义的趋势和深层原因。输出简洁的中文分析，不用感叹号，不用「值得关注」「引人深思」等AI修饰语。',
    });
    return resp.text.trim();
  } catch (err) {
    console.error('[DailyReport] LLM summary failed:', err);
    return '_（热点总结生成失败）_';
  }
}

export async function generateDailyReport(storage: Storage, dateStr?: string): Promise<DailyReport> {
  const now = new Date();
  const date = dateStr || formatDate(now);
  const generatedAt = now.toISOString();

  // Warm up LLM connection before parallel calls
  await isLlamaServerAvailable();

  const todayResult = storage.queryContent({ since: `${date}T00:00:00Z`, limit: 500, offset: 0 });
  let todayItems = todayResult.items;

  if (todayItems.length === 0) {
    const fallback = storage.queryContent({ since: hoursAgo(24), limit: 500, offset: 0 });
    todayItems = fallback.items;
  }

  const recentResult = storage.queryContent({ since: hoursAgo(4), limit: 500, offset: 0 });
  const recentCount = recentResult.items.length;

  const interestsRaw = storage.listInterests();
  const interests = interestsRaw
    .filter((i: any) => i.enabled !== false)
    .map((i: any) => ({ label: i.label || i.query, query: i.query }));

  const topicGroups = groupByTopic(todayItems, interests);

  const clusters: TopicCluster[] = [];

  for (const [topic, topicItems] of topicGroups) {
    if (topic === '其他' && topicItems.length < 3) continue;

    const dedupedItems = topicItems
      .filter((it, idx, arr) => arr.findIndex(x => x.source_url === it.source_url) === idx);

    const selectN = topic === '其他' ? 3 : 5;
    const curated = await curateTopic(topic, dedupedItems, selectN);

    if (curated.length > 0) {
      clusters.push({
        topic,
        items: curated.map(c => ({ fact: c.summary, url: c.url, platform: c.platform })),
        count: topicItems.length,
      });
    }
  }

  clusters.sort((a, b) => b.count - a.count);

  const hotSummary = await generateHotSummary(todayItems);
  const totalItems = todayItems.length;
  const markdown = buildMarkdown(date, generatedAt, totalItems, recentCount, hotSummary, clusters);

  return { date, generatedAt, totalItems, topicCount: clusters.length, hotSummary, clusters, recentCount, markdown };
}

function buildMarkdown(
  date: string,
  generatedAt: string,
  total: number,
  recentCount: number,
  hotSummary: string,
  clusters: TopicCluster[],
): string {
  const lines: string[] = [];
  // 北京时间展示（generatedAt 是 UTC ISO，直接 slice 会显示 UTC 造成"时间错乱"观感）
  const timeStr = new Date(generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });

  lines.push(`# 每日信息 · ${date}`);
  lines.push(`_${timeStr} 更新 · ${total} 条 · 最近 4h +${recentCount}_`);
  lines.push('');

  lines.push('## 热点');
  lines.push('');
  lines.push(hotSummary);
  lines.push('');

  for (const cluster of clusters) {
    if (cluster.topic === '其他') continue;
    lines.push(`## ${cluster.topic}（${cluster.count}）`);
    lines.push('');
    for (const item of cluster.items) {
      const src = platformShort(item.platform);
      if (item.url) {
        lines.push(`- ${item.fact} [${src}](${item.url})`);
      } else {
        lines.push(`- ${item.fact} _${src}_`);
      }
    }
    lines.push('');
  }

  const other = clusters.find(c => c.topic === '其他');
  if (other && other.items.length > 0) {
    lines.push(`## 其他（${other.count}）`);
    lines.push('');
    for (const item of other.items.slice(0, 5)) {
      const src = platformShort(item.platform);
      if (item.url) {
        lines.push(`- ${item.fact} [${src}](${item.url})`);
      } else {
        lines.push(`- ${item.fact} _${src}_`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

let cachedReport: DailyReport | null = null;
let cacheExpiry = 0;
let isGenerating = false;

const CACHE_TTL_MS = 30 * 60 * 1000;

export function backgroundRefresh(storage: Storage, dateStr: string): void {
  if (isGenerating) return;
  isGenerating = true;
  generateDailyReport(storage, dateStr)
    .then(report => {
      cachedReport = report;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      console.log(`[DailyReport] Background refresh done: ${report.totalItems} items`);
    })
    .catch(err => console.error('[DailyReport] Background refresh failed:', err))
    .finally(() => { isGenerating = false; });
}

export async function getCachedDailyReport(storage: Storage, dateStr?: string, force?: boolean): Promise<DailyReport> {
  const now = Date.now();
  const requestedDate = dateStr || formatDate(new Date());
  const cachedIsStale = !cachedReport || cachedReport.date !== requestedDate || now > cacheExpiry;

  if (cachedIsStale || force) {
    if (cachedReport) {
      backgroundRefresh(storage, requestedDate);
      return cachedReport;
    }
    backgroundRefresh(storage, requestedDate);
    return {
      date: requestedDate,
      generatedAt: new Date().toISOString(),
      totalItems: 0,
      topicCount: 0,
      hotSummary: '_报告正在生成中，请稍后刷新…_',
      clusters: [],
      recentCount: 0,
      markdown: `# 每日信息 · ${requestedDate}\n\n_报告正在后台生成中，约 30-60 秒后刷新可获取完整报告。_\n`,
    };
  }

  return cachedReport!;
}

export function startDailyReportCron(storage: Storage): void {
  const regenerate = async (label: string) => {
    console.log(`[DailyReport] ${label}...`);
    try {
      cachedReport = await generateDailyReport(storage);
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      console.log(`[DailyReport] Done: ${cachedReport.totalItems} items / ${cachedReport.topicCount} topics`);
    } catch (err) {
      console.error(`[DailyReport] ${label} failed:`, err);
    }
  };

  cron.schedule('5 0 * * *', () => regenerate('Midnight'), { timezone: 'Asia/Shanghai' });
  cron.schedule('0 8 * * *', () => regenerate('Morning'), { timezone: 'Asia/Shanghai' });
  cron.schedule('0 12 * * *', () => regenerate('Noon'), { timezone: 'Asia/Shanghai' });
  cron.schedule('0 20 * * *', () => regenerate('Evening'), { timezone: 'Asia/Shanghai' });

  console.log('[DailyReport] Cron: 00:05, 08:00, 12:00, 20:00 (Asia/Shanghai) · DeepSeek Pro (1001)');

  setTimeout(() => regenerate('Startup'), 5000);
}
