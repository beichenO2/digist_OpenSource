/**
 * YouTube video discovery scraper via yt-dlp search.
 * No API key needed — uses yt-dlp's built-in ytsearch.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Scraper, ScraperOptions, ScraperResult, ContentItem } from '../types/index.js';

const exec = promisify(execFile);
const EXEC_TIMEOUT = 60_000;

function parseISODuration(dur: string | undefined): string {
  if (!dur) return '';
  const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return dur;
  const h = m[1] ? `${m[1]}:` : '';
  const min = (m[2] || '0').padStart(2, '0');
  const sec = (m[3] || '0').padStart(2, '0');
  return `${h}${min}:${sec}`;
}

export const youtubeScraper: Scraper = {
  name: 'youtube',
  platform: 'youtube',

  async scrape(query: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const maxItems = options.maxItems ?? 10;

    const searchQuery = query || 'trending';
    const args = [
      `ytsearch${maxItems}:${searchQuery}`,
      '--dump-json',
      '--flat-playlist',
      '--no-download',
      '--no-warnings',
    ];

    try {
      const { stdout } = await exec('yt-dlp', args, {
        timeout: EXEC_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      const lines = stdout.trim().split('\n').filter(Boolean);
      const items: ContentItem[] = [];

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          const videoId = data.id || data.url || '';
          const url = videoId.startsWith('http')
            ? videoId
            : `https://www.youtube.com/watch?v=${videoId}`;

          items.push({
            id: '',
            title: data.title || 'Untitled',
            body_markdown: [
              `## ${data.title || 'Untitled'}`,
              '',
              data.description?.slice(0, 500) || '',
              '',
              `Channel: ${data.channel || data.uploader || 'Unknown'}`,
              `Duration: ${parseISODuration(data.duration_string) || `${data.duration || 0}s`}`,
              `Views: ${data.view_count ?? 'N/A'}`,
              `URL: ${url}`,
            ].join('\n'),
            author: data.channel || data.uploader || '',
            timestamp: data.upload_date
              ? `${data.upload_date.slice(0, 4)}-${data.upload_date.slice(4, 6)}-${data.upload_date.slice(6, 8)}`
              : new Date().toISOString(),
            source_url: url,
            platform: 'youtube',
            tags: ['youtube', ...(data.categories || [])],
            raw_metadata: {
              view_count: data.view_count,
              like_count: data.like_count,
              duration: data.duration,
              channel_id: data.channel_id,
              channel: data.channel || data.uploader,
            },
            scraped_at: new Date().toISOString(),
          });
        } catch {
          // skip malformed JSON lines
        }
      }

      return {
        items: items.slice(0, maxItems),
        next_cursor: null,
        has_more: items.length >= maxItems,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[YouTube] Search error: ${msg.slice(0, 300)}`);
      return { items: [], next_cursor: null, has_more: false };
    }
  },
};
