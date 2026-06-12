import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { generateText, isLlamaServerAvailable } from '../utils/local-llm.js';
import { getUncompiledFiles, markAsCompiled } from './raw-ingester.js';

const DATA_DIR = process.env.DIGIST_DATA_DIR || './data';
const WIKI_DIR = join(DATA_DIR, 'wiki');
const OUTPUT_DIR = join(DATA_DIR, 'output');

export interface CompileResult {
  pages_updated: string[];
  pages_created: string[];
  items_processed: number;
  duration_ms: number;
  llm_available: boolean;
}

interface WikiPageMeta {
  slug: string;
  title: string;
  updated_at: string;
  sources: number;
}

interface RawItem {
  filepath: string;
  content: string;
  meta: Record<string, string>;
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

function readWikiIndex(): WikiPageMeta[] {
  const indexPath = join(WIKI_DIR, '_index.md');
  if (!existsSync(indexPath)) return [];
  const { meta } = parseFrontmatter(readFileSync(indexPath, 'utf-8'));
  try {
    const topics = meta.topics;
    if (topics && topics.startsWith('[')) return JSON.parse(topics);
  } catch { /* parse error */ }
  return existingPagesFromDir();
}

function existingPagesFromDir(): WikiPageMeta[] {
  mkdirSync(WIKI_DIR, { recursive: true });
  return readdirSync(WIKI_DIR)
    .filter(f => f.endsWith('.md') && f !== '_index.md')
    .map(f => ({
      slug: f.replace('.md', ''),
      title: f.replace('.md', '').replace(/-/g, ' '),
      updated_at: '',
      sources: 0,
    }));
}

function readRawItems(filepaths: string[]): RawItem[] {
  return filepaths.map(fp => {
    const content = readFileSync(fp, 'utf-8');
    const { meta, body } = parseFrontmatter(content);
    return { filepath: fp, content: body, meta };
  });
}

function groupByTopic(items: RawItem[]): Map<string, RawItem[]> {
  const groups = new Map<string, RawItem[]>();

  for (const item of items) {
    const tags = item.meta.tags || '';
    const keyPhrases = item.meta.key_phrases || '';
    const combined = `${tags} ${keyPhrases}`.toLowerCase();

    let topic = 'general';
    if (/\b(ai|llm|gpt|claude|model|neural|transformer|deep.?learn)/i.test(combined)) {
      topic = 'ai-ml';
    } else if (/\b(react|vue|next|web|css|html|frontend|backend|api|rest)/i.test(combined)) {
      topic = 'web-dev';
    } else if (/\b(rust|go|python|typescript|javascript|java|swift|kotlin)/i.test(combined)) {
      topic = 'programming-languages';
    } else if (/\b(docker|k8s|kubernetes|cloud|aws|gcp|azure|devops|ci.?cd)/i.test(combined)) {
      topic = 'infrastructure';
    } else if (/\b(crypto|blockchain|defi|web3|nft|token)/i.test(combined)) {
      topic = 'crypto-web3';
    } else if (/\b(startup|funding|vc|ipo|business|market|revenue)/i.test(combined)) {
      topic = 'business-tech';
    } else if (/\b(security|hack|vulnerability|exploit|malware|privacy)/i.test(combined)) {
      topic = 'security';
    } else if (/\b(open.?source|github|license|community|contributor)/i.test(combined)) {
      topic = 'open-source';
    }

    const group = groups.get(topic) || [];
    group.push(item);
    groups.set(topic, group);
  }
  return groups;
}

const TOPIC_LABELS: Record<string, string> = {
  'ai-ml': 'AI & Machine Learning',
  'web-dev': 'Web Development',
  'programming-languages': 'Programming Languages',
  'infrastructure': 'Infrastructure & DevOps',
  'crypto-web3': 'Crypto & Web3',
  'business-tech': 'Business & Tech Industry',
  'security': 'Security',
  'open-source': 'Open Source',
  'general': 'General Technology',
};

async function compileWithLLM(
  existingPage: string | null,
  newItems: RawItem[],
  topicLabel: string,
): Promise<string> {
  const rawSummaries = newItems
    .map((item, i) => {
      const platform = item.meta.platform || 'unknown';
      const title = item.meta.title || 'Untitled';
      return `### [${platform}] ${title}\n${item.content.slice(0, 800)}`;
    })
    .join('\n\n');

  const prompt = existingPage
    ? [
        `You are a knowledge wiki editor. Update the existing wiki page with new information.`,
        `Topic: ${topicLabel}`,
        ``,
        `## Existing page:`,
        existingPage.slice(0, 3000),
        ``,
        `## New raw material (${newItems.length} items):`,
        rawSummaries.slice(0, 4000),
        ``,
        `Rules:`,
        `1. Output a complete updated Markdown page`,
        `2. Use [[double brackets]] for cross-page references`,
        `3. Mark source platforms in parentheses`,
        `4. Flag contradictions with "> [!conflict]"`,
        `5. Bold **new entities**`,
        `6. Keep the page concise — synthesize, don't just append`,
      ].join('\n')
    : [
        `You are a knowledge wiki editor. Create a new wiki page from raw material.`,
        `Topic: ${topicLabel}`,
        ``,
        `## Raw material (${newItems.length} items):`,
        rawSummaries.slice(0, 5000),
        ``,
        `Rules:`,
        `1. Create a structured Markdown page with clear sections`,
        `2. Use [[double brackets]] for cross-page references`,
        `3. Mark source platforms in parentheses`,
        `4. Bold **key entities**`,
        `5. Synthesize information — don't just list items`,
        `6. Start with a one-paragraph overview`,
      ].join('\n');

  const resp = await generateText(prompt, {
    maxTokens: 2000,
    temperature: 0.4,
    system: 'You are a precise knowledge wiki editor. Output only Markdown content.',
  });

  return resp.text;
}

function compileFallback(
  existingPage: string | null,
  newItems: RawItem[],
  topicLabel: string,
): string {
  const sections: string[] = [];
  sections.push(`# ${topicLabel}\n`);
  sections.push(`*Last updated: ${new Date().toISOString()}*\n`);

  if (existingPage) {
    const bodyStart = existingPage.indexOf('\n## ');
    if (bodyStart > 0) {
      sections.push(existingPage.slice(bodyStart));
    }
  }

  sections.push(`\n## Latest Updates\n`);
  for (const item of newItems.slice(0, 20)) {
    const platform = item.meta.platform || 'unknown';
    const title = item.meta.title || 'Untitled';
    const url = item.meta.source_url || '';
    sections.push(`### [${platform}] ${title}`);
    if (url) sections.push(`*Source: ${url}*\n`);
    const summary = item.content.split('\n').filter(l => l.trim()).slice(0, 5).join('\n');
    sections.push(summary);
    sections.push('');
  }

  return sections.join('\n');
}

function writeWikiPage(slug: string, content: string, topicLabel: string, sourceCount: number): void {
  mkdirSync(WIKI_DIR, { recursive: true });
  const now = new Date().toISOString();
  const frontmatter = [
    '---',
    `slug: "${slug}"`,
    `title: "${topicLabel}"`,
    `updated_at: "${now}"`,
    `sources: ${sourceCount}`,
    '---',
  ].join('\n');

  writeFileSync(join(WIKI_DIR, `${slug}.md`), `${frontmatter}\n\n${content}`, 'utf-8');
}

function updateIndex(pages: WikiPageMeta[]): void {
  const now = new Date().toISOString();
  const topicsJson = JSON.stringify(pages);
  const topicList = pages.map(p => `- [${p.title}](./${p.slug}.md) — ${p.sources} sources`).join('\n');

  const content = [
    '---',
    `title: "DiGist Knowledge Wiki"`,
    `updated_at: "${now}"`,
    `topics: '${topicsJson}'`,
    `total_pages: ${pages.length}`,
    '---',
    '',
    '# DiGist Knowledge Wiki',
    '',
    `*Updated: ${now}*`,
    '',
    `## Topics (${pages.length})`,
    '',
    topicList,
  ].join('\n');

  writeFileSync(join(WIKI_DIR, '_index.md'), content, 'utf-8');
}

export async function compile(): Promise<CompileResult> {
  const start = Date.now();
  const uncompiled = getUncompiledFiles();

  if (uncompiled.length === 0) {
    return { pages_updated: [], pages_created: [], items_processed: 0, duration_ms: 0, llm_available: false };
  }

  const rawItems = readRawItems(uncompiled);
  const grouped = groupByTopic(rawItems);
  const llmAvailable = await isLlamaServerAvailable();

  const existingPages = readWikiIndex();
  const pagesUpdated: string[] = [];
  const pagesCreated: string[] = [];

  for (const [topic, items] of grouped) {
    const slug = topic;
    const label = TOPIC_LABELS[topic] || topic.replace(/-/g, ' ');
    const existingMeta = existingPages.find(p => p.slug === slug);

    let existingContent: string | null = null;
    const pagePath = join(WIKI_DIR, `${slug}.md`);
    if (existsSync(pagePath)) {
      const { body } = parseFrontmatter(readFileSync(pagePath, 'utf-8'));
      existingContent = body;
    }

    let newContent: string;
    if (llmAvailable) {
      try {
        newContent = await compileWithLLM(existingContent, items, label);
      } catch {
        newContent = compileFallback(existingContent, items, label);
      }
    } else {
      newContent = compileFallback(existingContent, items, label);
    }

    const totalSources = (existingMeta?.sources || 0) + items.length;
    writeWikiPage(slug, newContent, label, totalSources);

    if (existingContent) {
      pagesUpdated.push(slug);
    } else {
      pagesCreated.push(slug);
    }
  }

  for (const fp of uncompiled) {
    markAsCompiled(fp);
  }

  const allPages: WikiPageMeta[] = existingPagesFromDir().map(p => ({
    ...p,
    title: TOPIC_LABELS[p.slug] || p.title,
    updated_at: new Date().toISOString(),
  }));
  updateIndex(allPages);

  return {
    pages_updated: pagesUpdated,
    pages_created: pagesCreated,
    items_processed: rawItems.length,
    duration_ms: Date.now() - start,
    llm_available: llmAvailable,
  };
}

export async function compileReport(reportMarkdown: string, topic: string): Promise<void> {
  mkdirSync(join(OUTPUT_DIR, 'reports'), { recursive: true });
  const slug = slugify(topic);
  const filename = `${slug}-${Date.now()}.md`;
  writeFileSync(join(OUTPUT_DIR, 'reports', filename), reportMarkdown, 'utf-8');
}
