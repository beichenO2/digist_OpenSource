import { nanoid } from 'nanoid';
import type { ContentItem } from '../types/index.js';

export function normalize(raw: Partial<ContentItem>): ContentItem {
  return {
    id: raw.id || nanoid(),
    title: cleanText(raw.title || 'Untitled'),
    body_markdown: cleanMarkdown(raw.body_markdown || ''),
    author: cleanText(raw.author || 'Unknown'),
    timestamp: normalizeTimestamp(raw.timestamp),
    source_url: raw.source_url || '',
    platform: raw.platform || 'other',
    tags: normalizeTags(raw.tags),
    raw_metadata: raw.raw_metadata || {},
    scraped_at: raw.scraped_at || new Date().toISOString(),
  };
}

export function normalizeBatch(items: Partial<ContentItem>[]): ContentItem[] {
  return items.map(normalize);
}

export function deduplicateByUrl(items: ContentItem[]): ContentItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = urlHash(item.source_url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function calculateInfoDensity(item: ContentItem): number {
  const text = item.body_markdown;
  if (!text || text.length < 10) return 0;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const sentenceCount = text.split(/[.!?。！？]+/).filter(Boolean).length || 1;
  const avgWordPerSentence = wordCount / sentenceCount;

  const uniqueWords = new Set(text.toLowerCase().split(/\s+/));
  const lexicalDiversity = uniqueWords.size / Math.max(wordCount, 1);

  const codeBlocks = (text.match(/```/g) || []).length / 2;
  const links = (text.match(/\[.*?\]\(.*?\)/g) || []).length;
  const images = (text.match(/!\[.*?\]\(.*?\)/g) || []).length;

  const richness = (codeBlocks * 3 + links * 2 + images * 1.5) / Math.max(sentenceCount, 1);

  const density = (
    Math.min(avgWordPerSentence / 20, 1) * 0.3 +
    lexicalDiversity * 0.3 +
    Math.min(richness, 1) * 0.2 +
    Math.min(text.length / 2000, 1) * 0.2
  );

  return Math.round(density * 100) / 100;
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .trim();
}

function cleanMarkdown(md: string): string {
  return md
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .trim();
}

function normalizeTimestamp(ts?: string): string {
  if (!ts) return new Date().toISOString();
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  return [...new Set(
    tags
      .map(t => t.toLowerCase().trim())
      .filter(Boolean)
  )];
}

function urlHash(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}
