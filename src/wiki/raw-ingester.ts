import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { ContentItem } from '../types/index.js';
import type { CompressedDigest } from '../digestion/context-compressor.js';

const DATA_DIR = process.env.DIGIST_DATA_DIR || './data';
const RAW_DIR = join(DATA_DIR, 'raw');

export interface RawFileMeta {
  id: string;
  platform: string;
  source_url: string;
  title: string;
  author: string;
  scraped_at: string;
  ingested_at: string;
  density_score?: number;
  tags: string[];
  entities: string[];
  key_phrases: string[];
}

function toFrontmatter(meta: RawFileMeta): string {
  const lines = ['---'];
  lines.push(`id: "${meta.id}"`);
  lines.push(`platform: "${meta.platform}"`);
  lines.push(`source_url: "${meta.source_url}"`);
  lines.push(`title: "${meta.title.replace(/"/g, '\\"')}"`);
  lines.push(`author: "${meta.author}"`);
  lines.push(`scraped_at: "${meta.scraped_at}"`);
  lines.push(`ingested_at: "${meta.ingested_at}"`);
  if (meta.density_score !== undefined) {
    lines.push(`density_score: ${meta.density_score.toFixed(3)}`);
  }
  lines.push(`tags: [${meta.tags.map(t => `"${t}"`).join(', ')}]`);
  lines.push(`entities: [${meta.entities.slice(0, 20).map(e => `"${e}"`).join(', ')}]`);
  lines.push(`key_phrases: [${meta.key_phrases.slice(0, 10).map(p => `"${p}"`).join(', ')}]`);
  lines.push('compiled: false');
  lines.push('---');
  return lines.join('\n');
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

export function ingestToRaw(
  item: ContentItem,
  digest?: CompressedDigest,
  densityScore?: number,
): string {
  const platformDir = join(RAW_DIR, item.platform);
  mkdirSync(platformDir, { recursive: true });

  const filename = `${sanitizeFilename(item.id)}.md`;
  const filepath = join(platformDir, filename);

  const meta: RawFileMeta = {
    id: item.id,
    platform: item.platform,
    source_url: item.source_url,
    title: item.title,
    author: item.author,
    scraped_at: item.scraped_at,
    ingested_at: new Date().toISOString(),
    density_score: densityScore,
    tags: item.tags,
    entities: digest?.entities.map(e => e.text) ?? [],
    key_phrases: digest?.key_phrases ?? [],
  };

  const content = [
    toFrontmatter(meta),
    '',
    `# ${item.title}`,
    '',
    digest?.compressed_markdown ?? item.body_markdown,
  ].join('\n');

  writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

export function ingestBatchToRaw(
  items: ContentItem[],
  digests?: CompressedDigest[],
  densityScores?: number[],
): string[] {
  return items.map((item, i) =>
    ingestToRaw(
      item,
      digests?.[i],
      densityScores?.[i],
    ),
  );
}

export function getUncompiledFiles(): string[] {
  const results: string[] = [];

  if (!existsSync(RAW_DIR)) return results;

  for (const platform of readdirSync(RAW_DIR)) {
    const platformDir = join(RAW_DIR, platform);
    try {
      for (const file of readdirSync(platformDir)) {
        if (!file.endsWith('.md')) continue;
        const filepath = join(platformDir, file);
        results.push(filepath);
      }
    } catch { /* skip non-directories */ }
  }

  return results.filter(f => {
    try {
      const { readFileSync } = require('fs');
      const content = readFileSync(f, 'utf-8');
      return content.includes('compiled: false');
    } catch { return false; }
  });
}

export function markAsCompiled(filepath: string): void {
  try {
    const { readFileSync } = require('fs');
    const content = readFileSync(filepath, 'utf-8') as string;
    writeFileSync(filepath, content.replace('compiled: false', 'compiled: true'), 'utf-8');
  } catch { /* ignore */ }
}
