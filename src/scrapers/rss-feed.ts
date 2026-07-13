/**
 * Generic RSS/Atom feed scraper factory (L1, login-free, no anti-bot).
 *
 * Bloomberg's own site (and the public RSSHub bridge) are behind aggressive
 * anti-crawling, so digist collects a stable, login-free finance/tech RSS
 * source (CNBC by default) instead. Swap the feed URLs to retarget. Reuses the
 * same RSS 2.0 / Atom parsing shape as wechat-rss.
 */
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

export interface RssFeedSource {
  url: string;
  label?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1].trim()) : '';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** Parse RSS 2.0 <item> and Atom <entry> into ContentItems. */
function parseFeed(xml: string, platform: ContentItem['platform'], sourceLabel: string): ContentItem[] {
  const items: ContentItem[] = [];
  const channelTitle = tag(xml, 'title') || sourceLabel;

  const isAtom = /<entry[\s>]/.test(xml) && !/<item[\s>]/.test(xml);
  const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const blocks = xml.match(blockRe) || [];

  for (const block of blocks) {
    const title = tag(block, 'title');
    if (!title) continue;
    let link = tag(block, 'link');
    if (!link) {
      const hrefM = block.match(/<link[^>]+href="([^"]+)"/i);
      link = hrefM ? hrefM[1] : '';
    }
    const pub = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    const desc = stripHtml(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'));
    const author = tag(block, 'author') || tag(block, 'dc:creator') || channelTitle;

    let timestamp = new Date().toISOString();
    if (pub) {
      const d = new Date(pub);
      if (!Number.isNaN(d.getTime())) timestamp = d.toISOString();
    }

    items.push({
      id: '',
      title,
      body_markdown: desc || title,
      author,
      timestamp,
      source_url: link,
      platform,
      tags: [platform, 'rss', sourceLabel].filter(Boolean),
      raw_metadata: { source_type: 'rss', source: sourceLabel, channel: channelTitle },
      scraped_at: new Date().toISOString(),
    });
  }
  return items;
}

/**
 * Build an RSS scraper that pulls from one or more feeds, newest first.
 * `defaultSources` is used when the caller passes no query; a query overrides
 * with a single explicit feed URL.
 */
export function createRssFeedScraper(
  platform: ContentItem['platform'],
  sourceLabel: string,
  defaultSources: RssFeedSource[],
): Scraper {
  return {
    name: platform,
    platform,
    async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
      const maxItems = options.maxItems ?? 20;
      const sources: RssFeedSource[] = query && /^https?:\/\//.test(query)
        ? [{ url: query }]
        : defaultSources;

      const all: ContentItem[] = [];
      for (const src of sources) {
        try {
          const resp = await fetch(src.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; digist-rss/1.0)' },
            signal: AbortSignal.timeout(15_000),
          });
          if (!resp.ok) {
            console.error(`[RSS:${platform}] ${resp.status} ${src.url}`);
            continue;
          }
          const xml = await resp.text();
          all.push(...parseFeed(xml, platform, src.label || sourceLabel));
        } catch (err) {
          console.error(`[RSS:${platform}] fetch error ${src.url}:`, err instanceof Error ? err.message : err);
        }
      }

      all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return { items: all.slice(0, maxItems), next_cursor: null, has_more: false };
    },
  };
}

// ── Bloomberg slot → CNBC (stable, login-free finance/tech RSS) ──
// Bloomberg.com is anti-crawl; CNBC official RSS is open and reliable (30/feed).
// Override the feeds via BLOOMBERG_RSS_URL (comma-separated) if desired.
const CNBC = (id: string) => `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=${id}`;
const bloombergFeeds: RssFeedSource[] = (process.env.BLOOMBERG_RSS_URL
  ? process.env.BLOOMBERG_RSS_URL.split(',').map(u => ({ url: u.trim() }))
  : [
      { url: CNBC('100003114'), label: 'cnbc-top-news' },
      { url: CNBC('19854910'), label: 'cnbc-tech' },
      { url: CNBC('20910258'), label: 'cnbc-economy' },
      { url: CNBC('10000664'), label: 'cnbc-finance' },
    ]);

export const bloombergScraper = createRssFeedScraper('bloomberg', 'cnbc', bloombergFeeds);
