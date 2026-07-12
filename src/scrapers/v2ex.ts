import { createSafeAxios, retryWithBackoff } from '../utils/anti-scraping.js';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const V2EX_API_BASES = ['https://www.v2ex.com/api', 'https://global.v2ex.co/api'];
const { client } = createSafeAxios({ rateLimiter: { maxRequests: 5, windowMs: 60_000 } });

interface V2exMember {
  username?: string;
}

interface V2exNode {
  name?: string;
  title?: string;
}

interface V2exTopic {
  id: number;
  title: string;
  content?: string;
  content_rendered?: string;
  url?: string;
  created?: number;
  member?: V2exMember;
  node?: V2exNode;
  replies?: number;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function topicToItem(topic: V2exTopic): ContentItem {
  const body =
    topic.content?.trim() ||
    (topic.content_rendered ? stripHtml(topic.content_rendered) : '') ||
    topic.title;

  return {
    id: '',
    title: topic.title,
    body_markdown: body,
    author: topic.member?.username || '',
    timestamp: new Date((topic.created || 0) * 1000).toISOString(),
    source_url: topic.url || `https://www.v2ex.com/t/${topic.id}`,
    platform: 'v2ex',
    tags: ['v2ex', topic.node?.name].filter(Boolean) as string[],
    raw_metadata: { v2ex_id: topic.id, node: topic.node?.name, replies: topic.replies },
    scraped_at: new Date().toISOString(),
  };
}

function parseTopics(data: unknown): V2exTopic[] {
  if (Array.isArray(data)) return data as V2exTopic[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.topics)) return obj.topics as V2exTopic[];
    if (obj.id != null && obj.title) return [obj as unknown as V2exTopic];
  }
  return [];
}

function buildRequest(query: string): { path: string; params?: Record<string, string> } {
  const q = query.trim();
  if (!q || q === 'hot') {
    return { path: '/topics/hot.json' };
  }
  if (/^\d+$/.test(q)) {
    return { path: '/topics/show.json', params: { id: q } };
  }
  return { path: '/topics/show.json', params: { node_name: q } };
}

async function fetchTopics(path: string, params?: Record<string, string>): Promise<V2exTopic[]> {
  // Multi-base failover IS the resilience here, so each base gets a short
  // timeout and at most one retry — otherwise an unreachable primary domain
  // (e.g. www.v2ex.com behind a cert/DNS issue) would burn ~30s of retries
  // before the reachable mirror is even tried, blowing the crawl budget.
  let lastErr: unknown;
  for (const base of V2EX_API_BASES) {
    try {
      const resp = await retryWithBackoff(
        () =>
          client.get(`${base}${path}`, {
            params,
            timeout: 6_000,
            headers: { 'User-Agent': 'digist/1.0' },
          }),
        1,
        500,
      );
      return parseTopics(resp.data);
    } catch (err) {
      lastErr = err;
      console.error(`[V2EX] ${base} failed:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr;
}

export const v2exScraper: Scraper = {
  name: 'v2ex',
  platform: 'v2ex',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 20;
    const { path, params } = buildRequest(query);

    try {
      const topics = await fetchTopics(path, params);
      const items = topics.slice(0, maxItems).map(topicToItem);
      return { items, next_cursor: null, has_more: false };
    } catch (err) {
      console.error('[V2EX] Scrape error:', err instanceof Error ? err.message : err);
      return { items: [], next_cursor: null, has_more: false };
    }
  },
};
