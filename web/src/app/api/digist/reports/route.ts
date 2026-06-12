import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/digist-paths";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");

    const reportDir = join(getDataDir(), "reports");
    if (!existsSync(reportDir)) {
      return NextResponse.json({ ok: true, files: [], content: null });
    }

    const files = readdirSync(reportDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();

    if (name) {
      const safe = name.replace(/[^a-zA-Z0-9._-]/g, "");
      if (!files.includes(safe)) {
        return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      }
      const content = readFileSync(join(reportDir, safe), "utf-8");
      return NextResponse.json({ ok: true, name: safe, content, files });
    }

    return NextResponse.json({ ok: true, files });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
