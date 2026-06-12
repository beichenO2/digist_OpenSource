import { NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";

export async function POST() {
  try {
    const task = getStorage().createTask("compile_wiki", {});
    return NextResponse.json({ ok: true, task, message: "Wiki compilation task created" }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
