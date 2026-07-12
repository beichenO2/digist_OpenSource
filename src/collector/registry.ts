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

function strategy(platform: string, scraper: Scraper): PlatformStrategy {
  return {
    platform,
    primary: scraperToL1Handler(scraper),
    fallback: l3FallbackFor(platform),
  };
}

export const l1Strategies: Record<string, PlatformStrategy> = {
  twitter: strategy('twitter', twitterScraper),
  reddit: strategy('reddit', redditScraper),
  wechat: strategy('wechat', wechatScraper),
  github: strategy('github', githubScraper),
  glass: strategy('glass', glassBridgeScraper),
  xiaohongshu: strategy('xiaohongshu', xiaohongshuScraper),
  zhihu: strategy('zhihu', zhihuScraper),
  arxiv: strategy('arxiv', arxivScraper),
  bilibili: strategy('bilibili', bilibiliScraper),
  hackernews: strategy('hackernews', hackernewsScraper),
  bloomberg: strategy('bloomberg', bloombergScraper),
  youtube: strategy('youtube', youtubeScraper),
  v2ex: strategy('v2ex', v2exScraper),
};

export function getStrategy(platform: string): PlatformStrategy | undefined {
  return l1Strategies[platform];
}
