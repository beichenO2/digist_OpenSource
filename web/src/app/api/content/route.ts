import { NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get("platform") || undefined;
    const limit = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50),
    );
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);
    const s = getStorage();
    const items = s.listContent(platform, limit, offset);
    return NextResponse.json({ ok: true, items, total: s.contentCount() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
