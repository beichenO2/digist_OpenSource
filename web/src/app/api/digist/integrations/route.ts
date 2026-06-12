import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Phase 11: 外部集成状态
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    glass: {
      hint: "Glass 内容经 glass scraper 写入 content_items（platform=glass），见采集任务与内容列表。",
    },
  });
}
