import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DIGIST_DATA_DIR || './data';
const WIKI_DIR = join(DATA_DIR, 'wiki');

export interface WikiPage {
  slug: string;
  title: string;
  updated_at: string;
  sources: number;
  content: string;
}

export interface WikiSearchResult {
  page: WikiPage;
  score: number;
  matched_terms: string[];
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      meta[key] = val;
    }
  }
  return { meta, body: match[2] ?? '' };
}

function loadAllPages(): WikiPage[] {
  if (!existsSync(WIKI_DIR)) return [];

  return readdirSync(WIKI_DIR)
    .filter(f => f.endsWith('.md') && f !== '_index.md')
    .map(f => {
      const content = readFileSync(join(WIKI_DIR, f), 'utf-8');
      const { meta, body } = parseFrontmatter(content);
      return {
        slug: f.replace('.md', ''),
        title: meta.title || f.replace('.md', '').replace(/-/g, ' '),
        updated_at: meta.updated_at || '',
        sources: parseInt(meta.sources || '0', 10),
        content: body,
      };
    });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

/**
 * Full-text search across wiki pages.
 * Scores by term frequency in title (3x weight) + content (1x weight).
 * This is the Karpathy approach: match against pre-compiled wiki pages,
 * then load the full page directly into context.
 */
export function searchWiki(query: string, topK = 5): WikiSearchResult[] {
  const pages = loadAllPages();
  if (pages.length === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const results: WikiSearchResult[] = [];

  for (const page of pages) {
    const titleTokens = tokenize(page.title);
    const contentTokens = tokenize(page.content);
    let score = 0;
    const matched: string[] = [];

    for (const term of queryTerms) {
      const titleHits = titleTokens.filter(t => t.includes(term) || term.includes(t)).length;
      const contentHits = contentTokens.filter(t => t === term).length;

      if (titleHits > 0 || contentHits > 0) {
        score += titleHits * 3 + Math.min(contentHits, 10);
        matched.push(term);
      }
    }

    if (score > 0) {
      const coverageBoost = matched.length / queryTerms.length;
      results.push({ page, score: score * coverageBoost, matched_terms: matched });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Load a specific wiki page by slug — the core of the "context stuffing" approach.
 * Returns the full markdown content to be placed directly in the LLM context window.
 */
export function loadWikiPage(slug: string): WikiPage | null {
  const filepath = join(WIKI_DIR, `${slug}.md`);
  if (!existsSync(filepath)) return null;

  const content = readFileSync(filepath, 'utf-8');
  const { meta, body } = parseFrontmatter(content);

  return {
    slug,
    title: meta.title || slug.replace(/-/g, ' '),
    updated_at: meta.updated_at || '',
    sources: parseInt(meta.sources || '0', 10),
    content: body,
  };
}

/**
 * List all wiki pages (metadata only, no content) for index/navigation.
 */
export function listWikiPages(): Omit<WikiPage, 'content'>[] {
  return loadAllPages().map(({ content: _, ...rest }) => rest);
}

/**
 * Get total wiki stats.
 */
export function getWikiStats(): {
  total_pages: number;
  total_sources: number;
  topics: string[];
  last_updated: string;
} {
  const pages = loadAllPages();
  return {
    total_pages: pages.length,
    total_sources: pages.reduce((sum, p) => sum + p.sources, 0),
    topics: pages.map(p => p.title),
    last_updated: pages
      .map(p => p.updated_at)
      .filter(Boolean)
      .sort()
      .pop() || '',
  };
}
