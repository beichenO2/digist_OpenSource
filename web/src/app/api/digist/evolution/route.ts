import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/digist-paths";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rawTail = parseInt(searchParams.get("tail") ?? "80", 10);
    const tail = Number.isFinite(rawTail) ? Math.min(Math.max(rawTail, 1), 500) : 80;
    const path = join(getDataDir(), "evolution", "evolution.jsonl");

    if (!existsSync(path)) {
      return NextResponse.json({ ok: true, entries: [], message: "暂无进化日志文件" });
    }

    const raw = readFileSync(path, "utf-8");
    const lines = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-tail);

    const entries = lines.map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    }).filter(Boolean);

    return NextResponse.json({ ok: true, entries });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
