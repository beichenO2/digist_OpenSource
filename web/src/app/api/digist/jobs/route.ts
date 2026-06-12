import { NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const storage = getStorage();
    const jobs = storage.listJobs();
    return NextResponse.json({ ok: true, jobs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
