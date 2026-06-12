import { getStorage } from "@/lib/digist-data";

export const dynamic = "force-dynamic";

/** Phase 11：调度中心视图 — 展示 SQLite 中的 cron 任务 */
export default async function SchedulerPage() {
  const s = getStorage();
  const jobs = s.listJobs();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold">智能调度中心</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        以下为持久化在{" "}
        <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-800">scrape_jobs</code>{" "}
        表中的定时采集任务。实际执行由 DiGist 引擎进程内的{" "}
        <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-800">Scheduler</code>{" "}
        驱动。Glass 屏幕流接入可在引擎环境变量与 CLI 中扩展。
      </p>

      <div className="mt-8 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
              <th className="px-4 py-3 font-medium">平台</th>
              <th className="px-4 py-3 font-medium">查询</th>
              <th className="px-4 py-3 font-medium">Cron</th>
              <th className="px-4 py-3 font-medium">启用</th>
              <th className="px-4 py-3 font-medium">上次运行</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  暂无任务。使用{" "}
                  <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-800">
                    digist job add ...
                  </code>{" "}
                  或等价 API 创建。
                </td>
              </tr>
            ) : (
              jobs.map((j) => (
                <tr
                  key={j.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                >
                  <td className="px-4 py-3 font-mono text-xs">{j.platform}</td>
                  <td className="max-w-xs truncate px-4 py-3">{j.query || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{j.cron_expression}</td>
                  <td className="px-4 py-3">{j.enabled ? "是" : "否"}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {j.last_run_at ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-10 rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          集成说明（Phase 11）
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <strong className="text-zinc-800 dark:text-zinc-200">实时监控</strong>
            ：本页与 Hub 进度独立；生产环境可将 Hub{" "}
            <code className="rounded bg-white px-1 text-xs dark:bg-zinc-900">hub_get_progress</code>{" "}
            接入同一面板。
          </li>
          <li>
            <strong className="text-zinc-800 dark:text-zinc-200">Glass</strong>
            ：已通过 <code className="rounded bg-white px-1 text-xs dark:bg-zinc-900">glass</code>{" "}
            平台与定时任务导入；见 ROADMAP Phase 9/11。
          </li>
        </ul>
      </section>
    </main>
  );
}
