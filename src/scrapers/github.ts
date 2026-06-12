import * as cheerio from 'cheerio';
import { createSafeAxios, retryWithBackoff } from '../utils/anti-scraping.js';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const { client } = createSafeAxios({ rateLimiter: { maxRequests: 10, windowMs: 60_000 } });

export const githubScraper: Scraper = {
  name: 'github',
  platform: 'github',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 25;
    const isTrending = query === 'trending' || query.startsWith('trending/');
    const lang = query.replace('trending/', '').replace('trending', '') || '';

    const url = isTrending
      ? `https://github.com/trending${lang ? `/${encodeURIComponent(lang)}` : ''}?since=daily`
      : `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories&s=stars&o=desc`;

    const resp = await retryWithBackoff(() => client.get(url, { headers: { Accept: 'text/html' } }));
    const $ = cheerio.load(resp.data);
    const items: ContentItem[] = [];

    const selector = isTrending ? 'article.Box-row' : 'div.search-title a';

    if (isTrending) {
      $('article.Box-row').slice(0, maxItems).each((_, el) => {
        const $el = $(el);
        const repoLink = $el.find('h2 a').attr('href')?.trim() || '';
        const repoName = repoLink.replace(/^\//, '');
        const description = $el.find('p').text().trim();
        const language = $el.find('[itemprop="programmingLanguage"]').text().trim();
        const starsText = $el.find('a[href*="/stargazers"]').text().trim().replace(/,/g, '');
        const stars = parseInt(starsText) || 0;
        const todayStars = $el.find('.d-inline-block.float-sm-right').text().trim();

        items.push({
          id: '',
          title: repoName,
          body_markdown: `## ${repoName}\n\n${description}\n\n- Language: ${language}\n- Stars: ${stars.toLocaleString()}\n- Today: ${todayStars}`,
          author: repoName.split('/')[0] || '',
          timestamp: new Date().toISOString(),
          source_url: `https://github.com${repoLink}`,
          platform: 'github',
          tags: [language, `stars:${stars}`, 'trending'].filter(Boolean),
          raw_metadata: { stars, language, today_stars: todayStars },
          scraped_at: new Date().toISOString(),
        });
      });
    } else {
      $('div[data-testid="results-list"] > div').slice(0, maxItems).each((_, el) => {
        const $el = $(el);
        const link = $el.find('a.prc-Link-Link-85e08').first();
        const repoPath = link.attr('href') || '';
        const repoName = link.text().trim();
        const desc = $el.find('span.search-match').text().trim() || $el.find('p').text().trim();
        const lang = $el.find('[aria-label="language"]').text().trim();

        if (repoName) {
          items.push({
            id: '',
            title: repoName,
            body_markdown: `## ${repoName}\n\n${desc}\n\n- Language: ${lang}`,
            author: repoName.split('/')[0] || '',
            timestamp: new Date().toISOString(),
            source_url: `https://github.com${repoPath}`,
            platform: 'github',
            tags: [lang, 'search'].filter(Boolean),
            raw_metadata: { query },
            scraped_at: new Date().toISOString(),
          });
        }
      });
    }

    return { items, next_cursor: null, has_more: false };
  },
};
