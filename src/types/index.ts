export interface ContentItem {
  id: string;
  title: string;
  body_markdown: string;
  author: string;
  timestamp: string;
  source_url: string;
  platform: 'twitter' | 'reddit' | 'wechat' | 'github' | 'glass' | 'xiaohongshu' | 'zhihu' | 'arxiv' | 'bilibili' | 'hackernews' | 'bloomberg' | 'youtube' | 'v2ex' | 'other';
  tags: string[];
  raw_metadata: Record<string, unknown>;
  scraped_at: string;
}

export interface ScrapeJob {
  id: string;
  platform: ContentItem['platform'];
  query: string;
  cron_expression: string;
  enabled: boolean;
  last_cursor: string | null;
  last_run_at: string | null;
  created_at: string;
}

export interface ScrapeCursor {
  job_id: string;
  cursor_key: string;
  cursor_value: string;
  updated_at: string;
}

export interface ScraperOptions {
  maxItems?: number;
  since?: string;
  cursor?: string | null;
  proxy?: string;
}

export interface ScraperResult {
  items: ContentItem[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface Scraper {
  name: string;
  platform: ContentItem['platform'];
  scrape(query: string, options?: ScraperOptions): Promise<ScraperResult>;
}

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

export interface AntiScrapingConfig {
  rateLimiter: RateLimiterConfig;
  userAgents: string[];
  maxRetries: number;
  retryBaseDelayMs: number;
  proxies: string[];
}
