import { NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";

export async function GET() {
  try {
    const s = getStorage();
    return NextResponse.json({ ok: true, jobs: s.listJobs() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
