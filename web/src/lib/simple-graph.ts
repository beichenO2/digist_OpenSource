/**
 * 轻量知识图谱快照（仅平台–来源），不依赖 digist/fusion，供 Next/Turbopack 打包。
 */
export type SimpleNode = {
  id: string;
  label: string;
  type: "source" | "platform";
  weight: number;
};

export type SimpleEdge = {
  source: string;
  target: string;
  type: "belongs_to";
  weight: number;
};

export type ContentLite = {
  id: string;
  title: string;
  platform: string;
  source_url: string;
  timestamp: string;
};

export function buildSimpleGraph(items: ContentLite[]): {
  nodes: SimpleNode[];
  edges: SimpleEdge[];
  stats: { nodes: number; edges: number; by_type: Record<string, number> };
} {
  const nodes: SimpleNode[] = [];
  const edges: SimpleEdge[] = [];
  const seenPlatform = new Set<string>();

  for (const it of items) {
    const sid = `source:${it.id}`;
    const pid = `platform:${it.platform}`;
    nodes.push({
      id: sid,
      label: it.title.slice(0, 120) || "(无标题)",
      type: "source",
      weight: 1,
    });
    if (!seenPlatform.has(pid)) {
      seenPlatform.add(pid);
      nodes.push({
        id: pid,
        label: it.platform,
        type: "platform",
        weight: 0,
      });
    } else {
      const pn = nodes.find((n) => n.id === pid);
      if (pn) pn.weight += 1;
    }
    edges.push({ source: sid, target: pid, type: "belongs_to", weight: 1 });
  }

  const by_type: Record<string, number> = {};
  for (const n of nodes) {
    by_type[n.type] = (by_type[n.type] ?? 0) + 1;
  }

  return {
    nodes,
    edges,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      by_type,
    },
  };
}

export function topNodes(nodes: SimpleNode[], n = 15): SimpleNode[] {
  return [...nodes].sort((a, b) => b.weight - a.weight).slice(0, n);
}
