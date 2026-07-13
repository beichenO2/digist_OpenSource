import { githubScraper } from '../scrapers/github.js';
import { glassBridgeScraper } from '../scrapers/glass-bridge.js';
import { redditScraper } from '../scrapers/reddit.js';
import { bilibiliScraper } from '../scrapers/bilibili.js';
import { v2exScraper } from '../scrapers/v2ex.js';
import { bloombergScraper } from '../scrapers/rss-feed.js';
import { wechatRssScraper as wechatScraper } from '../scrapers/wechat-rss.js';
import { arxivScraper } from '../scrapers/arxiv.js';
import { hackerNewsScraper as hackernewsScraper } from '../scrapers/hackernews.js';
import { youtubeScraper } from '../scrapers/youtube.js';
import type { Scraper } from '../types/index.js';
import type { LayerHandler, PlatformStrategy } from './types.js';
import { createL3Handler } from './l3/index.js';
import { L3_REGISTRATIONS } from './l3/configs.js';

function scraperToL1Handler(scraper: Scraper): LayerHandler {
  return {
    layer: 'L1',
    platform: scraper.platform,
    async handle(query, options) {
      const result = await scraper.scrape(query, options);
      return {
        items: result.items,
        next_cursor: result.next_cursor,
        has_more: result.has_more,
      };
    },
  };
}

function l3FallbackFor(platform: string): LayerHandler | undefined {
  const reg = L3_REGISTRATIONS[platform];
  if (!reg) return undefined;
  return createL3Handler(reg.config, reg.seed);
}

/** L1 scraper primary with optional L3 fallback. */
function strategy(platform: string, scraper: Scraper): PlatformStrategy {
  return {
    platform,
    primary: scraperToL1Handler(scraper),
    fallback: l3FallbackFor(platform),
  };
}

/**
 * L3-as-primary strategy: the anti-detect browser + LLM self-heal IS the main
 * path (no Safari dependency). Used for JS-heavy, login-free sites.
 */
function l3PrimaryStrategy(platform: string): PlatformStrategy {
  const reg = L3_REGISTRATIONS[platform];
  if (!reg) throw new Error(`No L3 registration for platform: ${platform}`);
  return { platform, primary: createL3Handler(reg.config, reg.seed) };
}

export const l1Strategies: Record<string, PlatformStrategy> = {
  reddit: strategy('reddit', redditScraper),
  wechat: strategy('wechat', wechatScraper),
  github: strategy('github', githubScraper),
  glass: strategy('glass', glassBridgeScraper),
  arxiv: strategy('arxiv', arxivScraper),
  bilibili: strategy('bilibili', bilibiliScraper),
  hackernews: strategy('hackernews', hackernewsScraper),
  youtube: strategy('youtube', youtubeScraper),
  v2ex: strategy('v2ex', v2exScraper),
  // bloomberg slot → CNBC 官方 RSS（L1 免登、零反爬；bloomberg.com 反爬弃用）。
  bloomberg: strategy('bloomberg', bloombergScraper),
  // ── L3-as-primary (anti-detect browser): JS-heavy, login-free sites ──
  zhihu: l3PrimaryStrategy('zhihu'),
  // twitter / xiaohongshu 已彻底移除采集（强风控高封号风险，用户指令停爬）。
};

export function getStrategy(platform: string): PlatformStrategy | undefined {
  return l1Strategies[platform];
}
