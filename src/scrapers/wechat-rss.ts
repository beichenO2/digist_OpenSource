/**
 * WeChat RSS Scraper — 通过 WeRSS (we-mp-rss) 的 RSS feed 抓取公众号文章
 *
 * WeRSS 通过 Port SDK 动态分配端口，微信扫码授权后自动采集公众号更新。
 * 本 scraper 拉取 WeRSS 的 RSS XML feed，解析为 ContentItem。
 */

import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

let _werssBase: string | null = null;

async function resolveWerssBase(): Promise<string> {
  if (_werssBase) return _werssBase;
  // Prefer wewe-rss (WEWE_RSS_URL) if configured, else legacy WeRSS (WERSS_URL).
  // Both expose standard RSS XML consumable by parseRssXml; for wewe-rss whose
  // feed listing path differs, pass a full feed URL as the scrape query.
  const explicit = process.env.WEWE_RSS_URL?.trim() || process.env.WERSS_URL?.trim();
  if (explicit) {
    _werssBase = explicit;
    return _werssBase;
  }
  try {
    const { createRequire } = await import('node:module');
    const { resolve, dirname } = await import('node:path');
    const _req = createRequire(import.meta.url);
    const sdkPath = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'PolarPort', 'src', 'sdk', 'index.cjs');
    const { getPort } = _req(sdkPath);
    const port = await getPort('werss');
    if (port) {
      _werssBase = `http://localhost:${port}`;
      return _werssBase;
    }
  } catch { /* port-sdk not available */ }
  throw new Error('[WeChat-RSS] Unable to resolve feed endpoint. Set WEWE_RSS_URL (wewe-rss) or WERSS_URL (legacy WeRSS), or register/start "werss" in SOTAgent.');
}

export const wechatRssScraper: Scraper = {
  name: 'wechat-rss',
  platform: 'wechat',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 30;

    if (query === 'all' || !query) {
      return scrapeAllFeeds(maxItems);
    }

    return scrapeFeed(query, maxItems);
  },
};

async function listMpAccounts(): Promise<Array<{ name: string; rss_url: string; fakeid: string }>> {
  const base = await resolveWerssBase();
  try {
    const res = await fetch(`${base}/api/mp/list`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: Array<{ name: string; fakeid: string }> };
    return (data.data || []).map(mp => ({
      name: mp.name,
      fakeid: mp.fakeid,
      rss_url: `${base}/rss/${mp.fakeid}.xml`,
    }));
  } catch (err) {
    console.error('[WeChat-RSS] Failed to list MP accounts:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function scrapeAllFeeds(maxItems: number): Promise<ScraperResult> {
  const accounts = await listMpAccounts();
  if (accounts.length === 0) {
    console.warn('[WeChat-RSS] No MP accounts found in WeRSS. Please add accounts in the WeRSS web console.');
    return { items: [], next_cursor: null, has_more: false };
  }

  const allItems: ContentItem[] = [];
  for (const acc of accounts) {
    const result = await scrapeFeed(acc.fakeid, Math.ceil(maxItems / accounts.length));
    allItems.push(...result.items);
  }

  allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return { items: allItems.slice(0, maxItems), next_cursor: null, has_more: false };
}

async function scrapeFeed(feedIdOrName: string, maxItems: number): Promise<ScraperResult> {
  try {
    const base = await resolveWerssBase();
    const rssUrl = feedIdOrName.startsWith('http')
      ? feedIdOrName
      : `${base}/rss/${feedIdOrName}.xml`;
    const res = await fetch(rssUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`[WeChat-RSS] RSS fetch failed: ${res.status} ${rssUrl}`);
      return { items: [], next_cursor: null, has_more: false };
    }

    const xml = await res.text();
    const items = parseRssXml(xml).slice(0, maxItems);
    return { items, next_cursor: null, has_more: false };
  } catch (err) {
    console.error('[WeChat-RSS] RSS fetch error:', err instanceof Error ? err.message : err);
    return { items: [], next_cursor: null, has_more: false };
  }
}

function parseRssXml(xml: string): ContentItem[] {
  const items: ContentItem[] = [];
  const channelTitle = extractTag(xml, 'title') || '未知公众号';

  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]!;
    const title = decodeEntities(extractTag(block, 'title') || '');
    const link = extractTag(block, 'link') || '';
    const pubDate = extractTag(block, 'pubDate') || '';
    const description = extractCdata(block, 'description') || '';
    const author = extractTag(block, 'author') || extractTag(block, 'dc:creator') || channelTitle;

    const bodyMd = htmlToSimpleMarkdown(description);

    items.push({
      id: '',
      title,
      body_markdown: bodyMd || `## ${title}`,
      author,
      timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      source_url: link,
      platform: 'wechat',
      tags: ['wechat', 'rss', channelTitle],
      raw_metadata: {
        source_type: 'rss',
        content_type: 'article',
        channel: channelTitle,
      },
      scraped_at: new Date().toISOString(),
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1]!.trim() : '';
}

function extractCdata(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const m = xml.match(re);
  if (m) return m[1]!.trim();
  return extractTag(xml, tag);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function htmlToSimpleMarkdown(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => '#'.repeat(Number(level)) + ' ' + text.trim() + '\n')
    .replace(/<img[^>]+src="([^"]*)"[^>]*>/gi, '![]($1)')
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
