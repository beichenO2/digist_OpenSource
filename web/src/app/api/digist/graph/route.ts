import { NextResponse } from "next/server";
import { buildSimpleGraph, topNodes } from "@/lib/simple-graph";
import { getStorage } from "@/lib/digist-data";

export const dynamic = "force-dynamic";

/** 与 /api/graph 一致：轻量平台–来源二部图（避免打包 digist/fusion 全量依赖） */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rawLimit = parseInt(searchParams.get("limit") ?? "2000", 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 5000)
      : 2000;

    const storage = getStorage();
    const items = storage.listContent(undefined, limit, 0);
    const lite = items.map((it) => ({
      id: it.id,
      title: it.title,
      platform: it.platform,
      source_url: it.source_url,
      timestamp: it.timestamp,
    }));
    const { nodes, edges, stats } = buildSimpleGraph(lite);
    const hubs = topNodes(nodes, 24);

    return NextResponse.json({
      ok: true,
      stats,
      nodes,
      edges,
      hubs,
      builtFromItems: items.length,
      note: "轻量图谱（平台–来源）。完整实体级图谱在引擎 KnowledgeGraph 中运行。",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
