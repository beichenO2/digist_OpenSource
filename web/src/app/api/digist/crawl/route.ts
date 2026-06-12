import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform, query, maxItems } = body;

    if (!platform) {
      return NextResponse.json({ ok: false, error: "platform is required" }, { status: 400 });
    }

    const task = getStorage().createTask("crawl", { platform, query: query || "", maxItems: maxItems || 20 });

    return NextResponse.json({ ok: true, task, message: `Crawl task created for ${platform}` }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
