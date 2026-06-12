/**
 * Stable programmatic crawl API for dependents (`digest.crawl_api` capability).
 * Mirrors CLI `digist scrape` platform wiring without touching storage.
 */
import { githubScraper } from '../scrapers/github.js';
import { glassBridgeScraper } from '../scrapers/glass-bridge.js';
import { redditScraper } from '../scrapers/reddit.js';
import {
  twitterScraper, xiaohongshuScraper,
  zhihuScraper, bilibiliScraper, bloombergScraper,
} from '../scrapers/safari-scraper.js';
import { wechatRssScraper as wechatScraper } from '../scrapers/wechat-rss.js';
import { arxivScraper } from '../scrapers/arxiv.js';
import { hackerNewsScraper as hackernewsScraper } from '../scrapers/hackernews.js';
import { youtubeScraper } from '../scrapers/youtube.js';
import type { Scraper, ScraperOptions, ScraperResult } from '../types/index.js';

export const crawlPlatforms = [
  'twitter', 'reddit', 'wechat', 'github', 'glass',
  'xiaohongshu', 'zhihu', 'arxiv', 'bilibili', 'hackernews', 'bloomberg', 'youtube',
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
  const s = scrapers[platform];
  if (!s) {
    throw new Error(`Unknown platform: ${platform}. Expected one of: ${crawlPlatforms.join(', ')}`);
  }
  return s.scrape(query, options);
}

export type { ScraperOptions, ScraperResult, Scraper } from '../types/index.js';
