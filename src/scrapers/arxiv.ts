import axios from 'axios';
import { retryWithBackoff } from '../utils/anti-scraping.js';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const ARXIV_API = 'http://export.arxiv.org/api/query';

function parseAtomXml(xml: string): ContentItem[] {
  const items: ContentItem[] = [];
  const entries = xml.split('<entry>').slice(1);

  for (const entry of entries) {
    const extract = (tag: string): string => {
      const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return match?.[1]?.trim() || '';
    };

    const title = extract('title').replace(/\s+/g, ' ');
    const summary = extract('summary').replace(/\s+/g, ' ');
    const published = extract('published');
    const updated = extract('updated');

    const idMatch = entry.match(/<id>(.*?)<\/id>/);
    const arxivId = idMatch?.[1] || '';
    const pdfLink = arxivId.replace('/abs/', '/pdf/');

    const authors: string[] = [];
    const authorMatches = entry.matchAll(/<author>\s*<name>(.*?)<\/name>/g);
    for (const m of authorMatches) authors.push(m[1]);

    const categories: string[] = [];
    const catMatches = entry.matchAll(/category[^>]*term="([^"]+)"/g);
    for (const m of catMatches) categories.push(m[1]);

    if (title) {
      items.push({
        id: '',
        title,
        body_markdown: `## ${title}\n\n**Authors**: ${authors.join(', ')}\n\n**Abstract**: ${summary}\n\n**Categories**: ${categories.join(', ')}\n\n[PDF](${pdfLink})`,
        author: authors[0] || '',
        timestamp: published || updated || new Date().toISOString(),
        source_url: arxivId,
        platform: 'arxiv',
        tags: [...categories.slice(0, 5), 'arxiv'],
        raw_metadata: { authors, categories, arxiv_id: arxivId, pdf: pdfLink },
        scraped_at: new Date().toISOString(),
      });
    }
  }
  return items;
}

export const arxivScraper: Scraper = {
  name: 'arxiv',
  platform: 'arxiv',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 20;
    const searchQuery = query.replace(/\s+/g, '+AND+');

    const url = `${ARXIV_API}?search_query=all:${encodeURIComponent(searchQuery)}&start=0&max_results=${maxItems}&sortBy=submittedDate&sortOrder=descending`;

    const resp = await retryWithBackoff(() => axios.get(url, { timeout: 30_000, headers: { Accept: 'application/atom+xml' } }));
    const items = parseAtomXml(resp.data);

    return { items, next_cursor: null, has_more: items.length >= maxItems };
  },
};
