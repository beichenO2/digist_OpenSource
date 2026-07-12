import { createSafeAxios } from '../utils/anti-scraping.js';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const { client } = createSafeAxios({ rateLimiter: { maxRequests: 10, windowMs: 60_000 } });

const GITHUB_API = 'https://api.github.com';

interface GitHubRepoItem {
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
}

interface GitHubSearchResponse {
  items: GitHubRepoItem[];
}

const EMPTY_RESULT: ScraperResult = { items: [], next_cursor: null, has_more: false };

function buildApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'digist/1.0',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildSearchQuery(query: string): { apiQuery: string; isTrending: boolean } {
  const isTrending = query === 'trending' || query.startsWith('trending/');
  const lang = query.replace('trending/', '').replace('trending', '').trim();

  if (isTrending) {
    let apiQuery = `created:>${daysAgoIsoDate(7)}`;
    if (lang) {
      apiQuery += ` language:${lang}`;
    }
    return { apiQuery, isTrending: true };
  }

  return { apiQuery: query, isTrending: false };
}

function mapRepoToContentItem(
  repo: GitHubRepoItem,
  apiQuery: string,
  isTrending: boolean,
): ContentItem {
  const { full_name, description, html_url, language, stargazers_count, forks_count, updated_at } = repo;
  const stars = stargazers_count;
  const forks = forks_count;
  const lang = language || '';

  return {
    id: '',
    title: full_name,
    body_markdown: `## ${full_name}\n\n${description || ''}\n\n- Language: ${lang}\n- Stars: ${stars}\n- Forks: ${forks}`,
    author: full_name.split('/')[0] || '',
    timestamp: updated_at,
    source_url: html_url,
    platform: 'github',
    tags: [lang, `stars:${stars}`, isTrending ? 'trending' : 'search'].filter(Boolean),
    raw_metadata: { stars, forks, language: lang, full_name, api_query: apiQuery },
    scraped_at: new Date().toISOString(),
  };
}

export const githubScraper: Scraper = {
  name: 'github',
  platform: 'github',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 25;
    const { apiQuery, isTrending } = buildSearchQuery(query);

    try {
      const resp = await client.get<GitHubSearchResponse>(`${GITHUB_API}/search/repositories`, {
        params: {
          q: apiQuery,
          sort: 'stars',
          order: 'desc',
          per_page: maxItems,
        },
        headers: buildApiHeaders(),
      });

      const items = (resp.data.items ?? [])
        .slice(0, maxItems)
        .map((repo) => mapRepoToContentItem(repo, apiQuery, isTrending));

      return { items, next_cursor: null, has_more: false };
    } catch (err) {
      console.error('[githubScraper] GitHub API request failed:', err);
      return EMPTY_RESULT;
    }
  },
};
