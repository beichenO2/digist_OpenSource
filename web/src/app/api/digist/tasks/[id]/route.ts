import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const task = getStorage().getTask(id);
    if (!task) {
      return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, task });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
