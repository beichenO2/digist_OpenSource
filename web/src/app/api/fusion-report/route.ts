import { NextResponse } from "next/server";
import { generateFusionReport } from "@digist/fusion/report-generator";
import { getStorage } from "@/lib/digist-data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const topic = searchParams.get("topic") ?? undefined;
    const rawLimit = parseInt(searchParams.get("limit") ?? "45", 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(120, Math.max(1, rawLimit))
      : 45;
    const s = getStorage();
    const items = s.listContent(undefined, limit, 0);
    if (items.length === 0) {
      return NextResponse.json({ ok: false, error: "no_items" }, { status: 404 });
    }
    const report = generateFusionReport(items, topic);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
