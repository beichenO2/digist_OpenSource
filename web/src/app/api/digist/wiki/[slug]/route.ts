import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/digist-paths";

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      meta[key] = val;
    }
  }
  return { meta, body: match[2] };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const safeSlug = slug.replace(/[^a-zA-Z0-9_\-]/g, "");
    const wikiDir = join(getDataDir(), "wiki");
    const filepath = join(wikiDir, `${safeSlug}.md`);

    if (!existsSync(filepath)) {
      return NextResponse.json(
        { ok: false, error: `Wiki page "${safeSlug}" not found` },
        { status: 404 },
      );
    }

    const raw = readFileSync(filepath, "utf-8");
    const { meta, body } = parseFrontmatter(raw);

    return NextResponse.json({
      ok: true,
      page: {
        slug: safeSlug,
        title: meta.title || safeSlug.replace(/-/g, " "),
        updated_at: meta.updated_at || "",
        sources: parseInt(meta.sources || "0", 10),
        content: body,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
