import { NextResponse } from "next/server";
import { buildSimpleGraph, topNodes } from "@/lib/simple-graph";
import { getStorage } from "@/lib/digist-data";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const maxItems = Math.min(
      200,
      Math.max(10, parseInt(searchParams.get("maxItems") || "120", 10) || 120),
    );
    const s = getStorage();
    const items = s.listContent(undefined, maxItems, 0);
    const lite = items.map((it) => ({
      id: it.id,
      title: it.title,
      platform: it.platform,
      source_url: it.source_url,
      timestamp: it.timestamp,
    }));
    const { nodes, edges, stats } = buildSimpleGraph(lite);
    const hubs = topNodes(nodes, 20);
    const capNodes = nodes.slice(0, 80);
    const capEdges = edges.slice(0, 150);
    return NextResponse.json({
      ok: true,
      stats,
      hubs: hubs.map((n) => ({
        id: n.id,
        label: n.label,
        type: n.type,
        weight: n.weight,
      })),
      bridging: [] as { id: string; label: string; weight: number }[],
      nodes: capNodes,
      edges: capEdges,
      truncated: nodes.length > capNodes.length || edges.length > capEdges.length,
      note: "轻量图谱：平台–来源二部图。完整实体关系见 digist 引擎 fusion 模块。",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
