import axios from 'axios';
import { retryWithBackoff } from '../utils/anti-scraping.js';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const HN_API = 'https://hacker-news.firebaseio.com/v0';

interface HNItem {
  id: number;
  title?: string;
  text?: string;
  url?: string;
  by?: string;
  time?: number;
  score?: number;
  descendants?: number;
  kids?: number[];
  type?: string;
}

async function fetchItem(id: number): Promise<HNItem> {
  return retryWithBackoff(async () => {
    const resp = await axios.get(`${HN_API}/item/${id}.json`, { timeout: 10_000 });
    return resp.data;
  });
}

async function fetchComments(kids: number[], maxComments = 5): Promise<string[]> {
  const comments: string[] = [];
  for (const kid of kids.slice(0, maxComments)) {
    try {
      const item = await fetchItem(kid);
      if (item.text) {
        const clean = item.text.replace(/<[^>]*>/g, '').trim();
        comments.push(`**${item.by || 'anon'}**: ${clean}`);
      }
    } catch { /* skip */ }
  }
  return comments;
}

export const hackerNewsScraper: Scraper = {
  name: 'hackernews',
  platform: 'hackernews',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 20;
    const endpoint = query === 'new' ? 'newstories' : query === 'ask' ? 'askstories' : query === 'show' ? 'showstories' : 'topstories';

    const resp = await retryWithBackoff(() => axios.get(`${HN_API}/${endpoint}.json`, { timeout: 10_000 }));
    const storyIds: number[] = resp.data.slice(0, maxItems);

    const items: ContentItem[] = [];
    for (const id of storyIds) {
      try {
        const story = await fetchItem(id);
        if (!story.title) continue;

        const commentTexts = story.kids ? await fetchComments(story.kids, 3) : [];
        const bodyParts = [story.url ? `[Link](${story.url})` : '', story.text?.replace(/<[^>]*>/g, '') || ''];
        if (commentTexts.length > 0) bodyParts.push('\n---\n### Top Comments\n' + commentTexts.join('\n\n'));

        items.push({
          id: '',
          title: story.title,
          body_markdown: bodyParts.filter(Boolean).join('\n\n'),
          author: story.by || '',
          timestamp: new Date((story.time || 0) * 1000).toISOString(),
          source_url: `https://news.ycombinator.com/item?id=${story.id}`,
          platform: 'hackernews',
          tags: ['hackernews', endpoint, `score:${story.score || 0}`],
          raw_metadata: { score: story.score, comments: story.descendants, hn_id: story.id },
          scraped_at: new Date().toISOString(),
        });
      } catch { /* skip */ }
    }

    return { items, next_cursor: null, has_more: false };
  },
};
