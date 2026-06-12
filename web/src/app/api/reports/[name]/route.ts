import { reportsDir } from "@/lib/digist-paths";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  if (!name || name.includes("..") || name.includes("/")) {
    return NextResponse.json({ ok: false, error: "invalid name" }, { status: 400 });
  }
  if (!name.endsWith(".md")) {
    return NextResponse.json({ ok: false, error: "only .md" }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid name" }, { status: 400 });
  }
  if (!name.startsWith("report-")) {
    return NextResponse.json({ ok: false, error: "invalid name" }, { status: 400 });
  }
  try {
    const fp = path.join(reportsDir(), name);
    const resolved = path.resolve(fp);
    const base = path.resolve(reportsDir());
    if (!resolved.startsWith(base)) {
      return NextResponse.json({ ok: false, error: "invalid path" }, { status: 400 });
    }
    const markdown = await readFile(resolved, "utf8");
    return NextResponse.json({ ok: true, name, markdown });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 404 });
  }
}
