import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { file, type, domain } = body;

    if (!file || !type) {
      return NextResponse.json(
        { ok: false, error: "file and type (pdf|audio|video) are required" },
        { status: 400 },
      );
    }

    if (!["pdf", "audio", "video"].includes(type)) {
      return NextResponse.json(
        { ok: false, error: "type must be: pdf, audio, or video" },
        { status: 400 },
      );
    }

    const task = getStorage().createTask("preprocess", { file, type, domain: domain || "general" });

    return NextResponse.json({ ok: true, task, message: `Preprocess task created for ${type}: ${file}` }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
