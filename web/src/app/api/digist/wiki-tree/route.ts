import { NextResponse } from "next/server";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/digist-paths";

interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
}

interface RawFileInfo {
  id: string;
  platform: string;
  title: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "Twitter/X",
  reddit: "Reddit",
  wechat: "WeChat",
  github: "GitHub",
  glass: "Glass",
  hackernews: "HackerNews",
  arxiv: "arXiv",
  bilibili: "Bilibili",
  xiaohongshu: "Xiaohongshu",
  other: "Other",
};

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      meta[key] = val;
    }
  }
  return meta;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "\u2026";
}

export async function GET() {
  try {
    const dataDir = getDataDir();
    const wikiDir = join(dataDir, "wiki");
    const rawDir = join(dataDir, "raw");

    const topics: Array<{ slug: string; title: string; sources: number }> = [];
    if (existsSync(wikiDir)) {
      for (const f of readdirSync(wikiDir)) {
        if (!f.endsWith(".md") || f === "_index.md") continue;
        const content = readFileSync(join(wikiDir, f), "utf-8");
        const meta = parseFrontmatter(content);
        topics.push({
          slug: f.replace(".md", ""),
          title: meta.title || f.replace(".md", "").replace(/-/g, " "),
          sources: parseInt(meta.sources || "0", 10),
        });
      }
    }

    const rawFiles: RawFileInfo[] = [];
    if (existsSync(rawDir)) {
      for (const platform of readdirSync(rawDir)) {
        const platformDir = join(rawDir, platform);
        try {
          for (const file of readdirSync(platformDir)) {
            if (!file.endsWith(".md")) continue;
            try {
              const content = readFileSync(join(platformDir, file), "utf-8");
              const meta = parseFrontmatter(content);
              rawFiles.push({
                id: meta.id || file.replace(".md", ""),
                platform: meta.platform || platform,
                title: meta.title || file.replace(".md", ""),
              });
            } catch { /* skip */ }
          }
        } catch { /* skip non-dirs */ }
      }
    }

    // Build topic-first tree: Root -> Topics -> Platforms -> Items
    const rawByTopic = new Map<string, Map<string, RawFileInfo[]>>();
    for (const file of rawFiles) {
      const topic = classifyFile(file, topics);
      if (!rawByTopic.has(topic)) rawByTopic.set(topic, new Map());
      const pm = rawByTopic.get(topic)!;
      if (!pm.has(file.platform)) pm.set(file.platform, []);
      pm.get(file.platform)!.push(file);
    }

    const topicNodes: TreeNode[] = topics.map((t) => {
      const platformMap = rawByTopic.get(t.slug) || new Map<string, RawFileInfo[]>();
      const platformNodes: TreeNode[] = [];

      for (const [platform, files] of platformMap) {
        platformNodes.push({
          id: `platform-${t.slug}-${platform}`,
          label: `${PLATFORM_LABELS[platform] || platform} (${files.length})`,
          children: files.slice(0, 50).map((f) => ({
            id: `item-${f.id}`,
            label: truncate(f.title, 40),
          })),
        });
      }

      return {
        id: `topic-${t.slug}`,
        label: `${t.title} (${t.sources})`,
        children: platformNodes.length > 0 ? platformNodes : undefined,
      };
    });

    if (topicNodes.length === 0 && rawFiles.length > 0) {
      const byPlatform = new Map<string, RawFileInfo[]>();
      for (const f of rawFiles) {
        if (!byPlatform.has(f.platform)) byPlatform.set(f.platform, []);
        byPlatform.get(f.platform)!.push(f);
      }
      for (const [platform, files] of byPlatform) {
        topicNodes.push({
          id: `platform-${platform}`,
          label: `${PLATFORM_LABELS[platform] || platform} (${files.length})`,
          children: files.slice(0, 50).map((f) => ({
            id: `item-${f.id}`,
            label: truncate(f.title, 40),
          })),
        });
      }
    }

    const tree: TreeNode = {
      id: "root",
      label: "DiGist Knowledge Base",
      children: topicNodes.length > 0
        ? topicNodes
        : [{ id: "empty", label: "No data yet — run the pipeline to populate" }],
    };

    return NextResponse.json({ ok: true, tree });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}

function classifyFile(
  file: RawFileInfo,
  topics: Array<{ slug: string }>,
): string {
  const text = file.title.toLowerCase();
  if (/\b(ai|llm|gpt|claude|model|neural|transformer)/i.test(text)) return "ai-ml";
  if (/\b(react|vue|next|web|frontend|backend|api)/i.test(text)) return "web-dev";
  if (/\b(rust|python|typescript|javascript|java)/i.test(text)) return "programming-languages";
  if (/\b(docker|k8s|cloud|aws|devops)/i.test(text)) return "infrastructure";
  return topics[0]?.slug || "general";
}
