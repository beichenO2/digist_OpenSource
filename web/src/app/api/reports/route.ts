import { reportsDir } from "@/lib/digist-paths";
import { readdir } from "fs/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let names: string[] = [];
    try {
      names = await readdir(reportsDir());
    } catch {
      names = [];
    }
    const md = names.filter((n) => n.endsWith(".md")).sort().reverse();
    return NextResponse.json({ ok: true, reports: md });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
