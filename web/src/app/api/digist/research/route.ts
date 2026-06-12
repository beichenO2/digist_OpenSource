import { NextResponse } from "next/server";

const DIGIST_API = process.env.DIGIST_API_URL || "http://127.0.0.1:3800";

export async function GET() {
  try {
    const resp = await fetch(`${DIGIST_API}/api/research/gaps`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Backend returned ${resp.status}`);
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 502 },
    );
  }
}

export async function POST() {
  try {
    const resp = await fetch(`${DIGIST_API}/api/research/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!resp.ok) throw new Error(`Backend returned ${resp.status}`);
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 502 },
    );
  }
}
