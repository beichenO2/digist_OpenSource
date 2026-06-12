import { createSafeAxios, retryWithBackoff } from '../utils/anti-scraping.js';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const { client } = createSafeAxios({ rateLimiter: { maxRequests: 5, windowMs: 60_000 } });

const BILI_SEARCH_API = 'https://api.bilibili.com/x/web-interface/search/type';
const BILI_HOT_API = 'https://api.bilibili.com/x/web-interface/ranking/v2';
const BILI_SPACE_API = 'https://api.bilibili.com/x/space/wbi/arc/search';

const BILI_HEADERS = { Referer: 'https://www.bilibili.com', Origin: 'https://www.bilibili.com' };

export type BiliSourceType = 'followed_creator' | 'keyword_hot' | 'keyword_latest' | 'big_hot';

export interface BiliScrapeOptions extends ScraperOptions {
  sourceType?: BiliSourceType;
  order?: 'pubdate' | 'click' | 'stow';
}

export const bilibiliScraper: Scraper = {
  name: 'bilibili',
  platform: 'bilibili',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const biliOpts = options as BiliScrapeOptions;
    const sourceType = biliOpts.sourceType || inferSourceType(query);
    const maxItems = options.maxItems ?? 20;

    switch (sourceType) {
      case 'followed_creator':
        return scrapeCreator(query, maxItems);
      case 'keyword_hot':
        return scrapeKeyword(query, maxItems, 'click');
      case 'keyword_latest':
        return scrapeKeyword(query, maxItems, 'pubdate');
      case 'big_hot':
        return scrapeHotRanking(maxItems);
      default:
        return scrapeKeyword(query, maxItems, 'click');
    }
  },
};

function inferSourceType(query: string): BiliSourceType {
  if (query === 'hot' || query === 'trending') return 'big_hot';
  if (/^\d+$/.test(query)) return 'followed_creator';
  return 'keyword_hot';
}

async function scrapeCreator(mid: string, maxItems: number): Promise<ScraperResult> {
  const items: ContentItem[] = [];
  try {
    const resp = await retryWithBackoff(() => client.get(BILI_SPACE_API, {
      params: { mid, ps: Math.min(maxItems, 30), tid: 0, pn: 1, order: 'pubdate' },
      headers: BILI_HEADERS,
    }));
    const list = resp.data?.data?.list?.vlist || [];
    for (const v of list.slice(0, maxItems)) {
      items.push(spaceVideoToItem(v, mid));
    }
  } catch (err) {
    console.error(`[Bilibili] Creator scrape error (mid=${mid}):`, err instanceof Error ? err.message : err);
  }
  return { items, next_cursor: null, has_more: false };
}

async function scrapeKeyword(
  keyword: string,
  maxItems: number,
  order: 'pubdate' | 'click' | 'stow',
): Promise<ScraperResult> {
  const items: ContentItem[] = [];
  const sourceType: BiliSourceType = order === 'pubdate' ? 'keyword_latest' : 'keyword_hot';
  try {
    const resp = await retryWithBackoff(() => client.get(BILI_SEARCH_API, {
      params: { search_type: 'video', keyword, page: 1, pagesize: maxItems, order },
      headers: BILI_HEADERS,
    }));
    const results = resp.data?.data?.result || [];
    for (const v of results.slice(0, maxItems)) {
      items.push(searchResultToItem(v, sourceType));
    }
  } catch (err) {
    console.error(`[Bilibili] Search error (keyword=${keyword}, order=${order}):`, err instanceof Error ? err.message : err);
  }
  return { items, next_cursor: null, has_more: false };
}

async function scrapeHotRanking(maxItems: number): Promise<ScraperResult> {
  const items: ContentItem[] = [];
  try {
    const resp = await retryWithBackoff(() => client.get(BILI_HOT_API, {
      params: { rid: 0, type: 'all' },
      headers: BILI_HEADERS,
    }));
    const list = resp.data?.data?.list || [];
    for (const v of list.slice(0, maxItems)) {
      items.push(videoToItem(v, 'big_hot'));
    }
  } catch (err) {
    console.error('[Bilibili] Hot ranking error:', err instanceof Error ? err.message : err);
  }
  return { items, next_cursor: null, has_more: false };
}

/**
 * Scrape all configured sources from source_configs DB entries.
 * Returns items tagged with their source_type metadata.
 */
export async function scrapeFromConfigs(
  configs: Array<{ platform: string; source_type: string; identifier: string; max_items?: number }>,
): Promise<ContentItem[]> {
  const allItems: ContentItem[] = [];
  for (const cfg of configs.filter(c => c.platform === 'bilibili')) {
    const result = await bilibiliScraper.scrape(cfg.identifier, {
      maxItems: cfg.max_items ?? 20,
      sourceType: cfg.source_type as BiliSourceType,
    } as BiliScrapeOptions);
    allItems.push(...result.items);
  }
  return allItems;
}

function videoToItem(v: any, sourceType: BiliSourceType): ContentItem {
  return {
    id: '',
    title: v.title || '',
    body_markdown: `## ${v.title}\n\n${v.desc || ''}\n\n- UP: ${v.owner?.name || ''}\n- 播放: ${v.stat?.view || 0}\n- 弹幕: ${v.stat?.danmaku || 0}\n- 点赞: ${v.stat?.like || 0}`,
    author: v.owner?.name || '',
    timestamp: new Date((v.pubdate || v.ctime || 0) * 1000).toISOString(),
    source_url: `https://www.bilibili.com/video/${v.bvid || ''}`,
    platform: 'bilibili',
    tags: ['bilibili', v.tname || ''].filter(Boolean),
    raw_metadata: {
      bvid: v.bvid,
      view: v.stat?.view,
      like: v.stat?.like,
      source_type: sourceType,
      content_type: 'video',
      has_subtitle: v.subtitle?.list?.length > 0,
    },
    scraped_at: new Date().toISOString(),
  };
}

function spaceVideoToItem(v: any, mid: string): ContentItem {
  return {
    id: '',
    title: v.title || '',
    body_markdown: `## ${v.title}\n\n${v.description || ''}\n\n- UP: ${v.author || ''}\n- 播放: ${v.play || 0}\n- 评论: ${v.comment || 0}`,
    author: v.author || '',
    timestamp: new Date((v.created || 0) * 1000).toISOString(),
    source_url: `https://www.bilibili.com/video/${v.bvid || ''}`,
    platform: 'bilibili',
    tags: ['bilibili', 'followed_creator'],
    raw_metadata: {
      bvid: v.bvid,
      mid,
      play: v.play,
      source_type: 'followed_creator' as const,
      content_type: 'video',
    },
    scraped_at: new Date().toISOString(),
  };
}

function searchResultToItem(v: any, sourceType: BiliSourceType): ContentItem {
  const title = (v.title || '').replace(/<[^>]*>/g, '');
  return {
    id: '',
    title,
    body_markdown: `## ${title}\n\n${v.description || ''}\n\n- UP: ${v.author || ''}\n- 播放: ${v.play || 0}`,
    author: v.author || '',
    timestamp: new Date((v.pubdate || 0) * 1000).toISOString(),
    source_url: `https://www.bilibili.com/video/${v.bvid || ''}`,
    platform: 'bilibili',
    tags: ['bilibili', sourceType],
    raw_metadata: {
      bvid: v.bvid,
      play: v.play,
      source_type: sourceType,
      content_type: 'video',
    },
    scraped_at: new Date().toISOString(),
  };
}
