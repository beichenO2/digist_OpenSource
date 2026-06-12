import { NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/digist-paths";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const storage = getStorage();
    const allContent = storage.contentCount();
    const jobs = storage.listJobs();
    const dataDir = getDataDir();

    const platforms = ["twitter", "reddit", "wechat", "github", "glass", "bilibili", "xiaohongshu", "hackernews", "arxiv"] as const;
    const platformStats: Record<string, { count: number; latest: string | null }> = {};
    for (const p of platforms) {
      const items = storage.listContent(p, 1, 0);
      const count = storage.listContent(p, 10000, 0).length;
      platformStats[p] = {
        count,
        latest: items[0]?.timestamp ?? null,
      };
    }

    const dbPath = join(dataDir, "digist.sqlite");
    let dbSizeMB = 0;
    if (existsSync(dbPath)) {
      dbSizeMB = Math.round(statSync(dbPath).size / 1024 / 1024 * 10) / 10;
    }

    const evoDir = join(dataDir, "evolution");
    let evolutionEntries = 0;
    const evoFile = join(evoDir, "evolution.jsonl");
    if (existsSync(evoFile)) {
      const raw = readFileSync(evoFile, "utf-8").trim();
      evolutionEntries = raw ? raw.split("\n").length : 0;
    }

    const reportDir = join(dataDir, "reports");
    let reportCount = 0;
    if (existsSync(reportDir)) {
      reportCount = readdirSync(reportDir).filter((f) => f.endsWith(".md")).length;
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      system: {
        contentTotal: allContent,
        dbSizeMB,
        evolutionEntries,
        reportCount,
        activeJobs: jobs.filter((j) => j.enabled).length,
        totalJobs: jobs.length,
      },
      scrapers: platformStats,
      jobs: jobs.map((j) => ({
        id: j.id,
        platform: j.platform,
        query: j.query,
        cron: j.cron_expression,
        enabled: j.enabled,
        lastRun: j.last_run_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
