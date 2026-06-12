/**
 * Reddit scraper — RSS feed only.
 *
 * Reddit blocked unauthenticated .json API access in late 2025 and stopped
 * issuing new OAuth App credentials entirely. RSS feeds (.rss endpoints)
 * remain open and require no authentication.
 *
 * Capabilities: title, body, author, timestamp, subreddit, URL.
 * Limitations: no score/upvotes, no comment counts (~25 items per request).
 */
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

interface RssEntry {
  title: string;
  link: string;
  author: string;
  published: string;
  content: string;
  subreddit: string;
}

function parseAtomXml(xml: string): RssEntry[] {
  const entries: RssEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
    };
    const linkMatch = block.match(/<link[^>]+href="([^"]+)"/);
    const catMatch = block.match(/<category[^>]+label="r\/([^"]+)"/);
    entries.push({
      title: get('title'),
      link: linkMatch?.[1] || '',
      author: get('name'),
      published: get('updated') || get('published'),
      content: get('content')?.slice(0, 2000) || get('title'),
      subreddit: catMatch?.[1] || '',
    });
  }
  return entries;
}

export const redditScraper: Scraper = {
  name: 'reddit',
  platform: 'reddit',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 25;
    const isSubreddit = query.startsWith('r/') || query.startsWith('/r/');

    const url = isSubreddit
      ? `https://www.reddit.com/${query.replace(/^\/?/, '')}.rss`
      : `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=relevance&t=week&limit=${maxItems}`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research feed reader)' },
    });

    if (!resp.ok) throw new Error(`Reddit RSS ${resp.status}: ${resp.statusText}`);

    const xml = await resp.text();
    const entries = parseAtomXml(xml).slice(0, maxItems);

    const items: ContentItem[] = entries.map((e) => ({
      id: '',
      title: e.title,
      body_markdown: e.content || e.title,
      author: e.author || '[unknown]',
      timestamp: e.published || new Date().toISOString(),
      source_url: e.link,
      platform: 'reddit' as const,
      tags: [e.subreddit].filter(Boolean),
      raw_metadata: { subreddit: e.subreddit },
      scraped_at: new Date().toISOString(),
    }));

    return { items, next_cursor: null, has_more: false };
  },
};
