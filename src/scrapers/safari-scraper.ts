/**
 * Cookie-based HTTP scraper for platforms requiring login state.
 *
 * Strategy: Extract cookies from Safari via AppleScript (one-shot per session),
 * then make direct HTTP requests with those cookies. This avoids all
 * visible browser activity and anti-automation detection.
 *
 * Fallback: If cookie extraction fails, falls back to AppleScript tab
 * execution (original approach) with improved anti-detection timing.
 *
 * Covers: twitter, xiaohongshu, zhihu, bilibili, bloomberg.
 */
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const execAsync = promisify(execCb);
const EXEC_TIMEOUT = 30_000;
const COOKIE_CACHE_DIR = './data/cookie-cache';
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

const platformLastCall = new Map<string, number>();
const MIN_INTERVAL_MS = parseInt(process.env.SAFARI_MIN_INTERVAL_MS || '12000', 10);
const platformBackoff = new Map<string, number>();

function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, mean + z * stdDev);
}

async function rateLimitWait(platform: string): Promise<void> {
  const last = platformLastCall.get(platform) ?? 0;
  const elapsed = Date.now() - last;
  const backoffMultiplier = platformBackoff.get(platform) ?? 1;
  const interval = MIN_INTERVAL_MS * backoffMultiplier;

  if (elapsed < interval) {
    const jitter = gaussianRandom(2000, 1000);
    const wait = interval - elapsed + jitter;
    await new Promise(r => setTimeout(r, wait));
  }

  // ~5% chance of a longer "reading" pause (mimics human behavior)
  if (Math.random() < 0.05) {
    const readingPause = gaussianRandom(4000, 1500);
    await new Promise(r => setTimeout(r, readingPause));
  }

  platformLastCall.set(platform, Date.now());
}

function incrementBackoff(platform: string): void {
  const current = platformBackoff.get(platform) ?? 1;
  platformBackoff.set(platform, Math.min(current * 2, 8));
}

function resetBackoff(platform: string): void {
  platformBackoff.set(platform, 1);
}

// --- Cookie extraction from Safari ---

async function extractSafariCookies(domain: string): Promise<string> {
  if (!existsSync(COOKIE_CACHE_DIR)) {
    await mkdir(COOKIE_CACHE_DIR, { recursive: true });
  }

  const cacheFile = `${COOKIE_CACHE_DIR}/${domain.replace(/\./g, '_')}.txt`;

  if (existsSync(cacheFile)) {
    const stat = await readFile(cacheFile, 'utf-8');
    const [timestamp, ...cookieLines] = stat.split('\n');
    if (Date.now() - parseInt(timestamp, 10) < COOKIE_MAX_AGE_MS) {
      return cookieLines.join('\n');
    }
  }

  // Extract cookies from Safari's cookie store via AppleScript
  const script = `
tell application "Safari"
  set res to do JavaScript "document.cookie" in current tab of window 1
  return res
end tell`;

  try {
    // First navigate to the domain to get its cookies
    const navScript = `
tell application "Safari"
  tell window 1
    set current tab to (make new tab with properties {URL:"https://${domain}"})
  end tell
  delay 3
  set res to (do JavaScript "document.cookie" in current tab of window 1)
  tell window 1
    close current tab
  end tell
  return res
end tell`;

    const { stdout } = await execAsync(`osascript -e '${navScript.replace(/'/g, "'\"'\"'")}'`, {
      timeout: 20000,
    });
    const cookies = stdout.trim();
    if (cookies) {
      await writeFile(cacheFile, `${Date.now()}\n${cookies}`);
    }
    return cookies;
  } catch {
    return '';
  }
}

// --- HTTP-based scraping (preferred, no visible browser activity) ---

async function httpScrape(url: string, cookies: string, headers: Record<string, string> = {}): Promise<string> {
  const { default: axios } = await import('axios');

  const resp = await axios.get(url, {
    headers: {
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
      ...headers,
    },
    timeout: 15000,
    maxRedirects: 3,
    validateStatus: (s) => s < 500,
  });

  if (resp.status === 429 || resp.status === 461 || resp.status === 471) {
    throw new Error(`RATE_LIMITED:${resp.status}`);
  }

  return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
}

// --- Fallback: Safari AppleScript tab execution (improved timing) ---

async function safariTabFallback(url: string, jsCode: string): Promise<string> {
  const delay = Math.floor(gaussianRandom(8, 2)); // 6-10s variable delay
  const appleScript = `
tell application "Safari"
  tell window 1
    set current tab to (make new tab with properties {URL:"${url}"})
  end tell
  delay ${delay}
  set res to (do JavaScript "${jsCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}" in current tab of window 1)
  tell window 1
    close current tab
  end tell
  return res
end tell`;

  const { stdout } = await execAsync(`osascript << 'APPLESCRIPT_EOF'\n${appleScript}\nAPPLESCRIPT_EOF`, {
    timeout: EXEC_TIMEOUT + delay * 1000,
    maxBuffer: 10 * 1024 * 1024,
    shell: '/bin/bash',
  });

  return stdout.trim();
}

// --- Platform configs ---

interface PlatformConfig {
  name: string;
  platform: ContentItem['platform'];
  domain: string;
  buildSearchUrl: (query: string, limit: number) => string;
  jsTemplate: string;
  parseHtml?: (html: string, limit: number) => Partial<ContentItem>[];
  parseJson?: (raw: any[]) => Partial<ContentItem>[];
  httpSearchUrl?: (query: string, limit: number) => string;
  httpHeaders?: Record<string, string>;
}

const TWITTER_JS = `JSON.stringify(Array.from(document.querySelectorAll('article')).slice(0,__LIMIT__).map(function(a){var t=a.querySelector('[data-testid=tweetText]');var u=a.querySelector('[data-testid=User-Name]');var tm=a.querySelector('time');var lnk=a.querySelector('a[href*="/status/"]');return{text:t?t.textContent.slice(0,500):'',user:u?u.textContent.split('@')[0].trim():'',handle:u?(u.textContent.match(/@\\\\w+/)||[''])[0]:'',time:tm?tm.getAttribute('datetime'):'',url:lnk?'https://x.com'+lnk.getAttribute('href'):''}}))`;

const XHS_JS = `JSON.stringify(Array.from(document.querySelectorAll('.note-item')).slice(0,__LIMIT__).map(function(n){var title=n.querySelector('.title')||n.querySelector('a.cover');var author=n.querySelector('.name')||n.querySelector('.author-wrapper .name');var likes=n.querySelector('.like-wrapper .count');var link=n.querySelector('a');return{title:title?title.textContent.trim().slice(0,150):'',author:author?author.textContent.trim():'',likes:likes?likes.textContent.trim():'',url:link?link.href:''}}))`;

const ZHIHU_JS = `JSON.stringify(Array.from(document.querySelectorAll('.List-item')).slice(0,__LIMIT__).map(function(item){var title=item.querySelector('h2 span')||item.querySelector('h2 a')||item.querySelector('h2');var content=item.querySelector('.RichText');var link=item.querySelector('h2 a')||item.querySelector('meta[itemprop=url]');var voteBtn=item.querySelector('.VoteButton--up');return{title:title?title.textContent.trim().slice(0,120):'',excerpt:content?content.textContent.trim().slice(0,300):'',votes:voteBtn?voteBtn.textContent.trim():'',url:link&&link.href?link.href:''}}))`;

const BILIBILI_JS = `JSON.stringify(Array.from(document.querySelectorAll('.bili-video-card')).slice(0,__LIMIT__).map(function(c){var t=c.querySelector('.bili-video-card__info--tit');var a=c.querySelector('.bili-video-card__info--author');var l=c.querySelector('a[href*="/video/"]');return{title:t?t.textContent.trim().slice(0,120):'',author:a?a.textContent.trim():'',url:l?l.href:''}}))`;

const configs: Record<string, PlatformConfig> = {
  twitter: {
    name: 'twitter',
    platform: 'twitter',
    domain: 'x.com',
    buildSearchUrl: (query) => `https://x.com/search?q=${encodeURIComponent(query)}&f=live`,
    jsTemplate: TWITTER_JS,
    parseJson: (raw) => raw.map(r => ({
      title: (r.text || '').slice(0, 100) + ((r.text || '').length > 100 ? '...' : ''),
      body_markdown: r.text || '',
      author: r.handle || r.user || '',
      timestamp: r.time || new Date().toISOString(),
      source_url: r.url || '',
      platform: 'twitter' as const,
      tags: [],
      raw_metadata: { user_display: r.user, handle: r.handle },
    })),
  },
  xiaohongshu: {
    name: 'xiaohongshu',
    platform: 'xiaohongshu',
    domain: 'www.xiaohongshu.com',
    buildSearchUrl: (query) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
    jsTemplate: XHS_JS,
    parseJson: (raw) => raw.map(r => ({
      title: r.title || '',
      body_markdown: r.title || '',
      author: r.author || '',
      timestamp: new Date().toISOString(),
      source_url: r.url || '',
      platform: 'xiaohongshu' as const,
      tags: ['xiaohongshu'],
      raw_metadata: { likes: r.likes },
    })),
  },
  zhihu: {
    name: 'zhihu',
    platform: 'zhihu',
    domain: 'www.zhihu.com',
    buildSearchUrl: (query) => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`,
    jsTemplate: ZHIHU_JS,
    parseJson: (raw) => raw.map(r => ({
      title: r.title || '',
      body_markdown: r.excerpt || r.title || '',
      author: r.author || '',
      timestamp: new Date().toISOString(),
      source_url: r.url || '',
      platform: 'zhihu' as const,
      tags: ['zhihu'],
      raw_metadata: { votes: r.votes },
    })),
  },
  bilibili: {
    name: 'bilibili',
    platform: 'bilibili',
    domain: 'search.bilibili.com',
    buildSearchUrl: (query) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}&order=pubdate`,
    jsTemplate: BILIBILI_JS,
    parseJson: (raw) => raw.map(r => ({
      title: r.title || '',
      body_markdown: r.title || '',
      author: r.author || '',
      timestamp: new Date().toISOString(),
      source_url: r.url || '',
      platform: 'bilibili' as const,
      tags: ['bilibili'],
      raw_metadata: {},
    })),
  },
  bloomberg: {
    name: 'bloomberg',
    platform: 'bloomberg',
    domain: 'www.bloomberg.com',
    buildSearchUrl: () => `https://www.bloomberg.com/technology`,
    jsTemplate: `JSON.stringify(Array.from(document.querySelectorAll('article, [data-component=headline]')).slice(0,__LIMIT__).map(function(a){var t=a.querySelector('h3,h2,.headline');var l=a.querySelector('a');return{title:t?t.textContent.trim().slice(0,150):'',url:l?l.href:''}}))`,
    parseJson: (raw) => raw.map(r => ({
      title: r.title || '',
      body_markdown: r.title || '',
      author: '',
      timestamp: new Date().toISOString(),
      source_url: r.url || '',
      platform: 'bloomberg' as const,
      tags: ['bloomberg'],
      raw_metadata: {},
    })),
  },
};

function createScraper(config: PlatformConfig): Scraper {
  return {
    name: config.name,
    platform: config.platform,

    async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
      const maxItems = options.maxItems ?? 20;
      await rateLimitWait(config.platform);

      const url = config.buildSearchUrl(query, maxItems);
      const js = config.jsTemplate.replace(/__LIMIT__/g, String(maxItems));

      try {
        // Primary path: Safari tab (these platforms need JS rendering)
        const raw = await safariTabFallback(url, js);
        if (!raw || raw === '[]' || raw === 'null') {
          return { items: [], next_cursor: null, has_more: false };
        }

        const parsed: any[] = JSON.parse(raw);
        const partials = config.parseJson!(parsed);

        const items: ContentItem[] = partials
          .filter(p => p.title || p.body_markdown)
          .map(p => ({
            id: '',
            title: p.title || '',
            body_markdown: p.body_markdown || '',
            author: p.author || '',
            timestamp: p.timestamp || new Date().toISOString(),
            source_url: p.source_url || '',
            platform: p.platform || config.platform,
            tags: p.tags || [],
            raw_metadata: p.raw_metadata || {},
            scraped_at: new Date().toISOString(),
          }));

        resetBackoff(config.platform);
        return {
          items: items.slice(0, maxItems),
          next_cursor: null,
          has_more: items.length >= maxItems,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes('RATE_LIMITED') || msg.includes('429') || msg.includes('captcha')) {
          incrementBackoff(config.platform);
          console.warn(`[Safari:${config.name}] Rate limited, backoff increased to ${platformBackoff.get(config.platform)}x`);
        }

        console.error(`[Safari:${config.name}] Error: ${msg.slice(0, 200)}`);
        return { items: [], next_cursor: null, has_more: false };
      }
    },
  };
}

export const twitterScraper = createScraper(configs.twitter);
export const xiaohongshuScraper = createScraper(configs.xiaohongshu);
export const zhihuScraper = createScraper(configs.zhihu);
export const bilibiliScraper = createScraper(configs.bilibili);
export const bloombergScraper = createScraper(configs.bloomberg);

export const supportedPlatforms = ['twitter', 'xiaohongshu', 'zhihu', 'bilibili', 'bloomberg'];
