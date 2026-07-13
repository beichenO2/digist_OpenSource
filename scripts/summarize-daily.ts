/**
 * Summarize today's scraped content into a knowledge digest.
 *
 * Uses DashScope Coding Plan API (qwen3.6-plus) to:
 * 1. Load today's raw scraped items from SQLite
 * 2. Group by domain (crypto/quant/finance/AI research/AI app)
 * 3. Generate per-domain summaries
 * 4. Produce a combined daily digest as Markdown
 *
 * Output: data/daily/YYYY-MM-DD/digest.md
 */
import { Storage } from '../src/storage/index.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';

const DB_PATH = process.env.DIGIST_DB || './data/digist.sqlite';
const DIGIST_TIME_ZONE = process.env.DIGIST_TIME_ZONE || 'Asia/Shanghai';

const POLARPRIVATE_URL = process.env.POLARPRIVATE_URL || 'http://127.0.0.1:12790';
// 日报走 0000：GLM-5.2，跨 xfyun + glm2 两条线负载均衡 50/50（MiniMax overflow）。
// 覆盖：DIGIST_SUMMARY_MODEL=glm2 可强制单走 glm2 线（128K），或 0100 走 DS-V4-Pro。
const DEFAULT_MODEL = process.env.DIGIST_SUMMARY_MODEL || '0000';
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 5000;

class LlmApiError extends Error {
  status: number;
  retryAfterMs?: number;

  constructor(status: number, body: string, retryAfterHeader: string | null) {
    super(`LLM API error: ${status} ${body}`);
    this.status = status;
    this.retryAfterMs = parseRetryAfterMs(body, retryAfterHeader);
  }
}

function parseRetryAfterMs(body: string, retryAfterHeader: string | null): number | undefined {
  if (retryAfterHeader) {
    const seconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }

  try {
    const parsed = JSON.parse(body) as { retry_after_seconds?: unknown };
    const seconds = Number(parsed.retry_after_seconds);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  } catch {
    // Response body is not always JSON.
  }

  return undefined;
}

function stripThinkingBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .replace(/<\/think>/g, '')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkPolarPrivate(): Promise<boolean> {
  try {
    const resp = await fetch(`${POLARPRIVATE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return false;
    const data = await resp.json() as { status?: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

async function callLLM(prompt: string, systemPrompt?: string): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt + '\n\n/no_think' });

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(
        `${POLARPRIVATE_URL}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: DEFAULT_MODEL,
            messages,
            max_tokens: 4000,
            temperature: 0.3,
            stream: false,
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );

      if (!resp.ok) {
        throw new LlmApiError(resp.status, await resp.text(), resp.headers.get('retry-after'));
      }

      const data = await resp.json() as {
        choices?: { message?: { content?: string } }[];
        detail?: string;
      };

      if (data.detail) throw new Error(`LLM error: ${data.detail}`);

      const raw = data.choices?.[0]?.message?.content || '';
      return stripThinkingBlocks(raw);
    } catch (err) {
      lastErr = err as Error;
      const retryable =
        !(err instanceof LlmApiError) || err.status === 429 || err.status >= 500;

      if (attempt < MAX_RETRIES && retryable) {
        const backoffMs =
          err instanceof LlmApiError && err.retryAfterMs
            ? err.retryAfterMs
            : RETRY_DELAY_MS * 2 ** attempt;
        console.log(`  [retry ${attempt + 1}/${MAX_RETRIES}] ${lastErr.message.slice(0, 120)}... waiting ${Math.round(backoffMs / 1000)}s`);
        await sleep(backoffMs);
      } else {
        break;
      }
    }
  }

  throw lastErr || new Error('LLM call failed after retries');
}

// Domain classification
function classifyItem(item: { platform: string; tags: string[]; title: string; body_markdown: string }): string {
  const text = `${item.title} ${item.body_markdown} ${item.tags.join(' ')}`.toLowerCase();

  if (/crypto|bitcoin|btc|eth|blockchain|defi|nft|web3|加密|币/.test(text)) return 'crypto';
  if (/quant|量化|algo.*trad|high.?freq|backtest|策略/.test(text)) return 'quant';
  if (/econom|金融|finance|market|fed|gdp|inflation|央行|利率/.test(text)) return 'finance';
  if (/arxiv|paper|model|benchmark|transformer|attention|training|scaling|论文|研究/.test(text)) return 'ai_research';
  if (/agent|tool|app|workflow|产品|工具|效率|cursor|claude|openai|gpt/.test(text)) return 'ai_app';
  return 'other';
}

const DOMAIN_NAMES: Record<string, string> = {
  crypto: '加密货币 & Web3',
  quant: '量化交易',
  finance: '金融 & 经济',
  ai_research: 'AI 科研前沿',
  ai_app: 'AI 应用前沿',
  other: '其他',
};

function appendFallbackItems(
  sections: string[],
  items: Array<{ title: string; source_url?: string | null; platform: string }>,
  reason: string,
): void {
  sections.push(`*LLM 总结暂不可用：${reason}。以下列出原始信息标题，避免日报空洞。*`);
  for (const item of items.slice(0, 10)) {
    const src = item.source_url ? ` — [来源](${item.source_url})` : ` — ${item.platform}`;
    sections.push(`- **${item.title}**${src}`);
  }
  if (items.length > 10) {
    sections.push(`- ...其余 ${items.length - 10} 条略`);
  }
  sections.push(`\n*（共 ${items.length} 条原始信息）*`);
}

function localDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DIGIST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function resolveTargetDate(): string {
  const argDate = process.argv[2] || process.env.DIGIST_DAILY_DATE || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(argDate)) return argDate;
  return localDateString();
}

function localDateRange(dateString: string): { start: Date; end: Date } {
  const start = new Date(`${dateString}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

async function main() {
  const today = resolveTargetDate();
  const { start, end } = localDateRange(today);
  const outputDir = `./data/daily/${today}`;
  mkdirSync(outputDir, { recursive: true });

  const storage = new Storage(DB_PATH);

  // Get today's items
  const allItems = storage.listContent(undefined, 10000);
  const todayItems = allItems.filter(item => {
    if (!item.scraped_at) return false;
    const scrapedAt = new Date(item.scraped_at);
    return scrapedAt >= start && scrapedAt < end;
  });

  console.log(`Found ${todayItems.length} items scraped today (${today})`);

  if (todayItems.length === 0) {
    console.log('No items to summarize. Run daily-digest.sh first.');
    storage.close();
    return;
  }

  // Group by domain
  const grouped: Record<string, typeof todayItems> = {};
  for (const item of todayItems) {
    const domain = classifyItem(item);
    (grouped[domain] ??= []).push(item);
  }

  console.log('Domain distribution:');
  for (const [domain, items] of Object.entries(grouped)) {
    console.log(`  ${DOMAIN_NAMES[domain] || domain}: ${items.length} items`);
  }

  const ppOk = await checkPolarPrivate();
  if (!ppOk) {
    console.error(`ERROR: PolarPrivate not reachable at ${POLARPRIVATE_URL}`);
    console.error('LLM summaries will be skipped. Raw item counts will still be recorded.');
  }

  // Generate summaries per domain
  const systemPrompt = `你是一个专业的信息分析师。你的任务是将一组新闻/帖子/论文摘要总结为一份简洁的中文知识摘要。
要求：
- 每个领域的摘要不超过 500 字
- 突出关键趋势、重要数据、值得关注的新事物
- 用 Markdown 格式输出
- 不要虚构任何信息，只基于提供的原文总结`;

  const sections: string[] = [];
  sections.push(`# 每日信息摘要 — ${today}\n`);
  sections.push(`> 采集时间: ${new Date().toISOString()}`);
  sections.push(`> 总计: ${todayItems.length} 条信息\n`);

  // Summarize domains with bounded concurrency (default 2). Domain summaries are
  // independent LLM calls; running a couple in parallel roughly halves Phase 3
  // without overloading PolarPrivate. Output order is preserved by index.
  const domainEntries = Object.entries(grouped);
  const SUMMARY_CONCURRENCY = Math.max(1, Number(process.env.DIGIST_SUMMARY_CONCURRENCY || '4'));
  const domainSections: string[] = new Array(domainEntries.length).fill('');

  async function summarizeDomain(idx: number, domain: string, items: typeof todayItems): Promise<void> {
    const domainName = DOMAIN_NAMES[domain] || domain;
    const parts: string[] = [`\n## ${domainName}\n`];

    if (!ppOk) {
      for (const item of items.slice(0, 10)) {
        const src = item.source_url ? ` — [来源](${item.source_url})` : '';
        parts.push(`- **${item.title}**${src}`);
      }
      parts.push(`\n*（共 ${items.length} 条，PolarPrivate 不可用，仅列出标题）*`);
      domainSections[idx] = parts.join('\n');
      return;
    }

    console.log(`Summarizing ${domainName} (${items.length} items)...`);
    const itemTexts = items.slice(0, 30).map((item, i) =>
      `[${i + 1}] ${item.title}\n${item.body_markdown?.slice(0, 300) || ''}\n来源: ${item.source_url || item.platform}`
    ).join('\n\n');

    try {
      const summary = await callLLM(
        `以下是今天关于「${domainName}」领域的 ${items.length} 条信息（展示前 ${Math.min(items.length, 30)} 条）:\n\n${itemTexts}\n\n请总结以上信息的关键要点。`,
        systemPrompt,
      );
      parts.push(summary, `\n*（共 ${items.length} 条原始信息）*`);
    } catch (err) {
      console.error(`Failed to summarize ${domainName}:`, err);
      const localParts: string[] = [];
      appendFallbackItems(localParts, items, err instanceof Error ? err.message.slice(0, 180) : String(err).slice(0, 180));
      parts.push(...localParts);
    }
    domainSections[idx] = parts.join('\n');
  }

  for (let i = 0; i < domainEntries.length; i += SUMMARY_CONCURRENCY) {
    const batch = domainEntries.slice(i, i + SUMMARY_CONCURRENCY);
    await Promise.all(batch.map(([domain, items], j) => summarizeDomain(i + j, domain, items)));
  }
  sections.push(...domainSections);

  // Source list
  sections.push('\n---\n## 信息来源\n');
  const platformCounts: Record<string, number> = {};
  for (const item of todayItems) {
    platformCounts[item.platform] = (platformCounts[item.platform] || 0) + 1;
  }
  for (const [platform, count] of Object.entries(platformCounts).sort((a, b) => b[1] - a[1])) {
    sections.push(`- **${platform}**: ${count} 条`);
  }

  const digest = sections.join('\n');
  const outputPath = `${outputDir}/digest.md`;
  writeFileSync(outputPath, digest);
  console.log(`\nDigest written to: ${outputPath}`);

  storage.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
