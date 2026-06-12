import FirecrawlApp from '@mendable/firecrawl-js';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || 'fc-dummy';
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL || 'http://127.0.0.1:3002';

let _client: FirecrawlApp | null = null;

function getClient(): FirecrawlApp {
  if (!_client) {
    _client = new FirecrawlApp({
      apiKey: FIRECRAWL_API_KEY,
      apiUrl: FIRECRAWL_API_URL,
    });
  }
  return _client;
}

export function isFirecrawlConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY || !!process.env.FIRECRAWL_API_URL;
}

function extractPlatform(url: string): ContentItem['platform'] {
  if (!url) return 'other';
  const host = url.toLowerCase();
  if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
  if (host.includes('reddit.com')) return 'reddit';
  if (host.includes('github.com')) return 'github';
  if (host.includes('arxiv.org')) return 'arxiv';
  if (host.includes('bilibili.com')) return 'bilibili';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('hackernews') || host.includes('ycombinator.com')) return 'hackernews';
  if (host.includes('bloomberg.com')) return 'bloomberg';
  if (host.includes('zhihu.com')) return 'zhihu';
  if (host.includes('xiaohongshu.com')) return 'xiaohongshu';
  return 'other';
}

export const firecrawlSearchScraper: Scraper = {
  name: 'firecrawl-search',
  platform: 'other',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 10;
    const client = getClient();

    try {
      const response = await client.search(query, {
        limit: maxItems,
        scrapeOptions: { formats: ['markdown'] },
      });

      if (!response.success || !response.data) {
        console.error(`[Firecrawl] Search failed: ${(response as any).error || 'unknown'}`);
        return { items: [], next_cursor: null, has_more: false };
      }

      const items: ContentItem[] = response.data.map((doc: any) => ({
        id: '',
        title: doc.metadata?.title || doc.metadata?.ogTitle || '',
        body_markdown: doc.markdown || doc.content || '',
        author: doc.metadata?.author || '',
        timestamp: doc.metadata?.publishedTime || new Date().toISOString(),
        source_url: doc.metadata?.sourceURL || doc.url || '',
        platform: extractPlatform(doc.metadata?.sourceURL || doc.url || ''),
        tags: ['firecrawl'],
        raw_metadata: {
          description: doc.metadata?.description,
          ogImage: doc.metadata?.ogImage,
          statusCode: doc.metadata?.statusCode,
        },
        scraped_at: new Date().toISOString(),
      }));

      return {
        items: items.slice(0, maxItems),
        next_cursor: null,
        has_more: items.length >= maxItems,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Firecrawl] Search error: ${msg.slice(0, 200)}`);
      return { items: [], next_cursor: null, has_more: false };
    }
  },
};

export async function scrapeUrl(url: string): Promise<ContentItem | null> {
  const client = getClient();

  try {
    const response = await client.scrapeUrl(url, {
      formats: ['markdown'],
    });

    if (!response.success) {
      console.error(`[Firecrawl] Scrape failed for ${url}: ${(response as any).error || 'unknown'}`);
      return null;
    }

    const doc = response as any;
    return {
      id: '',
      title: doc.metadata?.title || '',
      body_markdown: doc.markdown || '',
      author: doc.metadata?.author || '',
      timestamp: doc.metadata?.publishedTime || new Date().toISOString(),
      source_url: doc.metadata?.sourceURL || url,
      platform: extractPlatform(url),
      tags: ['firecrawl'],
      raw_metadata: {
        description: doc.metadata?.description,
        statusCode: doc.metadata?.statusCode,
      },
      scraped_at: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Firecrawl] Scrape error for ${url}: ${msg.slice(0, 200)}`);
    return null;
  }
}
