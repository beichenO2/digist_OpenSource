import { NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";
import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/digist-paths";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const storage = getStorage();
    const total = storage.contentCount();
    const jobs = storage.listJobs();
    const dataDir = getDataDir();
    const reportDir = join(dataDir, "reports");
    const evoFile = join(dataDir, "evolution", "evolution.jsonl");

    let reportCount = 0;
    if (existsSync(reportDir)) {
      reportCount = readdirSync(reportDir).filter((f) => f.endsWith(".md")).length;
    }

    let evolutionEntries = 0;
    if (existsSync(evoFile)) {
      const evoRaw = readFileSync(evoFile, "utf-8").trim();
      evolutionEntries = evoRaw ? evoRaw.split("\n").length : 0;
    }

    const byPlatform: Record<string, number> = {};
    const sample = storage.listContent(undefined, 5000, 0);
    for (const row of sample) {
      byPlatform[row.platform] = (byPlatform[row.platform] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      contentTotal: total,
      jobsEnabled: jobs.filter((j) => j.enabled).length,
      jobsTotal: jobs.length,
      reportFiles: reportCount,
      hasEvolutionLog: existsSync(evoFile),
      evolutionEntries,
      byPlatform,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
