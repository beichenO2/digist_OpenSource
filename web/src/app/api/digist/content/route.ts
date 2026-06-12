import { NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get("platform") ?? undefined;
    const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
    const rawOffset = parseInt(searchParams.get("offset") ?? "0", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
    const q = searchParams.get("q")?.trim();

    const storage = getStorage();
    if (q) {
      const items = storage.searchContent(q, limit);
      return NextResponse.json({ ok: true, items, search: q });
    }

    const items = storage.listContent(platform, limit, offset);
    return NextResponse.json({
      ok: true,
      items,
      total: storage.contentCount(),
      limit,
      offset,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
