import { NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";

export const dynamic = "force-dynamic";

/**
 * Phase 11: 调度中心 — 从 SQLite 暴露采集任务与 Glass 内容占比（实时监控数据面）
 */
export async function GET() {
  try {
    const storage = getStorage();
    const jobs = storage.listJobs();
    const glassish = storage.listContent("glass", 5000, 0);
    const allN = storage.contentCount();

    return NextResponse.json({
      ok: true,
      polledAt: new Date().toISOString(),
      jobs: jobs.map((j) => ({
        id: j.id,
        platform: j.platform,
        query: j.query,
        cron: j.cron_expression,
        enabled: j.enabled,
        lastRunAt: j.last_run_at,
        lastCursor: j.last_cursor,
      })),
      stats: {
        contentTotal: allN,
        glassItemsInSample: glassish.length,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
