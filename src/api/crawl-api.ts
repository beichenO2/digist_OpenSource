/**
 * Stable programmatic crawl API for dependents (`digest.crawl_api` capability).
 * Mirrors CLI `digist scrape` platform wiring without touching storage.
 */
import { githubScraper } from '../scrapers/github.js';
import { glassBridgeScraper } from '../scrapers/glass-bridge.js';
import { redditScraper } from '../scrapers/reddit.js';
import {
  twitterScraper, xiaohongshuScraper,
  zhihuScraper, bloombergScraper,
} from '../scrapers/safari-scraper.js';
import { bilibiliScraper } from '../scrapers/bilibili.js';
import { v2exScraper } from '../scrapers/v2ex.js';
import { wechatRssScraper as wechatScraper } from '../scrapers/wechat-rss.js';
import { arxivScraper } from '../scrapers/arxiv.js';
import { hackerNewsScraper as hackernewsScraper } from '../scrapers/hackernews.js';
import { youtubeScraper } from '../scrapers/youtube.js';
import { collect } from '../collector/layered-collector.js';
import { canScrapePlatformNow } from '../scheduler/risk-window-policy.js';
import type { Scraper, ScraperOptions, ScraperResult } from '../types/index.js';

export const crawlPlatforms = [
  'twitter', 'reddit', 'wechat', 'github', 'glass',
  'xiaohongshu', 'zhihu', 'arxiv', 'bilibili', 'hackernews', 'bloomberg', 'youtube', 'v2ex',
] as const;

export type CrawlPlatform = (typeof crawlPlatforms)[number];

const scrapers: Record<CrawlPlatform, Scraper> = {
  twitter: twitterScraper,
  reddit: redditScraper,
  wechat: wechatScraper,
  github: githubScraper,
  glass: glassBridgeScraper,
  xiaohongshu: xiaohongshuScraper,
  zhihu: zhihuScraper,
  arxiv: arxivScraper,
  bilibili: bilibiliScraper,
  hackernews: hackernewsScraper,
  bloomberg: bloombergScraper,
  youtube: youtubeScraper,
  v2ex: v2exScraper,
};

export function getCrawlScraper(platform: string): Scraper | undefined {
  return scrapers[platform as CrawlPlatform];
}

/**
 * Run a single scrape for the given platform (same contract as CLI `scrape`).
 * For `glass`, `query` may be empty string to pull recent bridge data.
 */
export async function crawl(
  platform: CrawlPlatform,
  query: string,
  options?: ScraperOptions,
): Promise<ScraperResult> {
  const policy = canScrapePlatformNow(platform);
  if (!policy.allowed) {
    throw new Error(policy.reason ?? `${platform} is temporarily disabled`);
  }

  const result = await collect(platform, query, options);
  return {
    items: result.items,
    next_cursor: result.next_cursor,
    has_more: result.has_more,
  };
}

export type { ScraperOptions, ScraperResult, Scraper } from '../types/index.js';
