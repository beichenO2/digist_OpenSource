import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { evolutionJsonlPath } from "@/lib/digist-paths";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get("limit") || "80", 10) || 80),
    );
    const path = evolutionJsonlPath();
    if (!existsSync(path)) {
      return NextResponse.json({ ok: true, entries: [], path });
    }
    const raw = readFileSync(path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return NextResponse.json({ ok: true, entries, path });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
