import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DIGIST_DATA_DIR || './data';
const WIKI_DIR = join(DATA_DIR, 'wiki');
const RAW_DIR = join(DATA_DIR, 'raw');

export interface WikiTreeNode {
  id: string;
  label: string;
  children?: WikiTreeNode[];
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
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
  return meta;
}

interface RawFileInfo {
  id: string;
  platform: string;
  title: string;
}

function scanRawFiles(): RawFileInfo[] {
  if (!existsSync(RAW_DIR)) return [];
  const results: RawFileInfo[] = [];

  for (const platform of readdirSync(RAW_DIR)) {
    const platformDir = join(RAW_DIR, platform);
    try {
      for (const file of readdirSync(platformDir)) {
        if (!file.endsWith('.md')) continue;
        try {
          const content = readFileSync(join(platformDir, file), 'utf-8');
          const meta = parseFrontmatter(content);
          results.push({
            id: meta.id || file.replace('.md', ''),
            platform: meta.platform || platform,
            title: meta.title || file.replace('.md', ''),
          });
        } catch { /* skip unreadable */ }
      }
    } catch { /* skip non-directories */ }
  }

  return results;
}

function getWikiTopics(): Array<{ slug: string; title: string; sources: number }> {
  if (!existsSync(WIKI_DIR)) return [];

  return readdirSync(WIKI_DIR)
    .filter(f => f.endsWith('.md') && f !== '_index.md')
    .map(f => {
      const content = readFileSync(join(WIKI_DIR, f), 'utf-8');
      const meta = parseFrontmatter(content);
      return {
        slug: f.replace('.md', ''),
        title: meta.title || f.replace('.md', '').replace(/-/g, ' '),
        sources: parseInt(meta.sources || '0', 10),
      };
    });
}

/**
 * Build topic-first hierarchy:
 *   Root → Topics → Platforms → Content Items
 *
 * Each view level shows only 2 tiers (parent + children),
 * matching the Mermaid two-level drill-down pattern.
 */
export function buildWikiTree(): WikiTreeNode {
  const topics = getWikiTopics();
  const rawFiles = scanRawFiles();

  const rawByPlatformByTopic = new Map<string, Map<string, RawFileInfo[]>>();

  for (const file of rawFiles) {
    const topic = classifyToTopic(file, topics);

    if (!rawByPlatformByTopic.has(topic)) {
      rawByPlatformByTopic.set(topic, new Map());
    }
    const platformMap = rawByPlatformByTopic.get(topic)!;
    if (!platformMap.has(file.platform)) {
      platformMap.set(file.platform, []);
    }
    platformMap.get(file.platform)!.push(file);
  }

  const topicNodes: WikiTreeNode[] = topics.map(topic => {
    const platformMap = rawByPlatformByTopic.get(topic.slug) || new Map();

    const platformNodes: WikiTreeNode[] = [];
    for (const [platform, files] of platformMap) {
      const contentNodes: WikiTreeNode[] = files.slice(0, 50).map((f: RawFileInfo) => ({
        id: `item-${f.id}`,
        label: truncate(f.title, 40),
      }));

      platformNodes.push({
        id: `platform-${topic.slug}-${platform}`,
        label: `${platformLabel(platform)} (${files.length})`,
        children: contentNodes.length > 0 ? contentNodes : undefined,
      });
    }

    return {
      id: `topic-${topic.slug}`,
      label: `${topic.title} (${topic.sources})`,
      children: platformNodes.length > 0 ? platformNodes : undefined,
    };
  });

  if (topicNodes.length === 0) {
    const platformGroups = new Map<string, RawFileInfo[]>();
    for (const f of rawFiles) {
      const arr = platformGroups.get(f.platform) || [];
      arr.push(f);
      platformGroups.set(f.platform, arr);
    }

    for (const [platform, files] of platformGroups) {
      topicNodes.push({
        id: `platform-${platform}`,
        label: `${platformLabel(platform)} (${files.length})`,
        children: files.slice(0, 50).map(f => ({
          id: `item-${f.id}`,
          label: truncate(f.title, 40),
        })),
      });
    }
  }

  return {
    id: 'root',
    label: 'DiGist Knowledge Base',
    children: topicNodes.length > 0 ? topicNodes : [{ id: 'empty', label: 'No data yet' }],
  };
}

function classifyToTopic(
  file: RawFileInfo,
  topics: Array<{ slug: string; title: string }>,
): string {
  const text = `${file.title}`.toLowerCase();

  for (const topic of topics) {
    const keywords = topic.slug.split('-');
    if (keywords.some(kw => kw.length > 2 && text.includes(kw))) {
      return topic.slug;
    }
  }

  if (/\b(ai|llm|gpt|claude|model|neural|transformer)/i.test(text)) return 'ai-ml';
  if (/\b(react|vue|next|web|frontend|backend|api)/i.test(text)) return 'web-dev';
  if (/\b(rust|python|typescript|javascript|java)/i.test(text)) return 'programming-languages';
  if (/\b(docker|k8s|cloud|aws|devops)/i.test(text)) return 'infrastructure';

  return topics[0]?.slug || 'general';
}

const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'Twitter/X',
  reddit: 'Reddit',
  wechat: 'WeChat',
  github: 'GitHub',
  glass: 'Glass',
  hackernews: 'HackerNews',
  arxiv: 'arXiv',
  bilibili: 'Bilibili',
  xiaohongshu: 'Xiaohongshu',
  other: 'Other',
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] || platform;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '\u2026';
}
