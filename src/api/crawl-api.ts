/**
 * Stable programmatic crawl API for dependents (`digest.crawl_api` capability).
 * Mirrors CLI `digist scrape` platform wiring without touching storage.
 */
import { collect } from '../collector/layered-collector.js';
import { getStrategy } from '../collector/registry.js';
import { canScrapePlatformNow } from '../scheduler/risk-window-policy.js';
import type { ScraperOptions, ScraperResult } from '../types/index.js';

// twitter/xiaohongshu removed — 强风控高封号风险，已停止采集（用户指令）。
// bloomberg/zhihu now served by L3 (no Safari); the rest are L1 免登.
export const crawlPlatforms = [
  'reddit', 'wechat', 'github', 'glass',
  'zhihu', 'arxiv', 'bilibili', 'hackernews', 'bloomberg', 'youtube', 'v2ex',
] as const;

export type CrawlPlatform = (typeof crawlPlatforms)[number];

/**
 * Run a single scrape for the given platform (same contract as CLI `scrape`).
 * For `glass`, `query` may be empty string to pull recent bridge data.
 * Routes through the LayeredCollector (L1 primary → L3 fallback where configured).
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

/** True if the platform is registered in the collector (used for validation). */
export function isCrawlPlatform(platform: string): boolean {
  return getStrategy(platform) !== undefined;
}

export type { ScraperOptions, ScraperResult, Scraper } from '../types/index.js';
