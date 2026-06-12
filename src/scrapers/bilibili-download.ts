import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bilibiliScraper } from './bilibili.js';
import type { ContentItem } from '../types/index.js';

const execFileAsync = promisify(execFile);

const DEFAULT_VIDEO_DIR = './data/videos';
const SESSDATA = process.env.BILIBILI_SESSDATA || '';

export interface DownloadOptions {
  outputDir?: string;
  quality?: 'best' | '1080p' | '720p' | '480p';
  maxItems?: number;
  subtitles?: boolean;
}

const QUALITY_MAP: Record<string, string> = {
  best: 'bestvideo+bestaudio/best',
  '1080p': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
  '720p': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
  '480p': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
};

export async function downloadBilibiliVideo(
  url: string,
  options: DownloadOptions = {},
): Promise<{ path: string; title: string } | null> {
  const dir = options.outputDir || DEFAULT_VIDEO_DIR;
  mkdirSync(dir, { recursive: true });

  const format = QUALITY_MAP[options.quality || '720p'];
  const args = [
    '-f', format,
    '--merge-output-format', 'mp4',
    '-o', join(dir, '%(title).80s [%(id)s].%(ext)s'),
    '--no-playlist',
    '--no-overwrites',
  ];

  if (SESSDATA) {
    args.push('--cookies-from-browser', 'chrome');
  }

  if (options.subtitles) {
    args.push('--write-subs', '--sub-langs', 'zh-Hans,zh-Hant,en', '--embed-subs');
  }

  args.push(url);

  try {
    console.log(`[Bilibili DL] Downloading: ${url}`);
    const { stdout, stderr } = await execFileAsync('yt-dlp', args, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const destMatch = stdout.match(/\[Merger\] Merging formats into "([^"]+)"|Destination: (.+\.mp4)/);
    const mergeMatch = stdout.match(/has already been downloaded/);
    
    if (destMatch) {
      const path = destMatch[1] || destMatch[2];
      console.log(`[Bilibili DL] Saved: ${path}`);
      return { path, title: path };
    }
    
    if (mergeMatch) {
      console.log(`[Bilibili DL] Already downloaded, skipping`);
      return null;
    }

    const files = readdirSync(dir).filter(f => f.endsWith('.mp4')).sort((a, b) => {
      const sa = statSync(join(dir, a));
      const sb = statSync(join(dir, b));
      return sb.mtimeMs - sa.mtimeMs;
    });
    if (files.length > 0) {
      const path = join(dir, files[0]);
      console.log(`[Bilibili DL] Saved: ${path}`);
      return { path, title: files[0] };
    }

    if (stderr) console.error(`[Bilibili DL] stderr: ${stderr.slice(0, 500)}`);
    return null;
  } catch (err: any) {
    console.error(`[Bilibili DL] Error: ${err.message || err}`);
    if (err.stderr) console.error(`[Bilibili DL] ${err.stderr.slice(0, 500)}`);
    return null;
  }
}

export async function discoverAndDownload(
  query: string,
  options: DownloadOptions = {},
): Promise<{ downloaded: string[]; skipped: number; errors: number }> {
  const maxItems = options.maxItems ?? 5;
  const dir = options.outputDir || join(DEFAULT_VIDEO_DIR, sanitize(query));
  mkdirSync(dir, { recursive: true });

  console.log(`[Bilibili DL] Discovering videos for: "${query}" (max ${maxItems})`);
  const result = await bilibiliScraper.scrape(query, { maxItems });

  const downloaded: string[] = [];
  let skipped = 0;
  let errors = 0;

  for (const item of result.items.slice(0, maxItems)) {
    if (!item.source_url) { skipped++; continue; }

    const bvid = item.source_url.match(/BV[\w]+/)?.[0];
    if (!bvid) { skipped++; continue; }

    const existing = readdirSync(dir).find(f => f.includes(bvid));
    if (existing) {
      console.log(`[Bilibili DL] Skip (exists): ${item.title.slice(0, 60)}`);
      skipped++;
      continue;
    }

    const dl = await downloadBilibiliVideo(item.source_url, { ...options, outputDir: dir });
    if (dl) {
      downloaded.push(dl.path);
    } else {
      errors++;
    }

    await sleep(2000);
  }

  console.log(`\n[Bilibili DL] Done: ${downloaded.length} downloaded, ${skipped} skipped, ${errors} errors`);
  return { downloaded, skipped, errors };
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 50);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
