import { existsSync, readFileSync } from "fs";
import { evolutionJsonlPath } from "@/lib/digist-paths";

export const dynamic = "force-dynamic";

type EvoEntry = {
  id: number;
  timestamp: string;
  type: string;
  description: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  impact_measured: number | null;
  rollback_possible?: boolean;
};

export default async function EvolutionPage() {
  const path = evolutionJsonlPath();
  let entries: EvoEntry[] = [];
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf-8");
    entries = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as EvoEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is EvoEntry => x !== null)
      .slice(-100)
      .reverse();
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold">进化日志</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        读取{" "}
        <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-800">{path}</code>
        中最近 100 条记录（新在前）。
      </p>

      <ul className="mt-8 space-y-3">
        {entries.length === 0 ? (
          <li className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
            暂无进化记录。引擎运行并触发策略变更后会追加 JSONL。
          </li>
        ) : (
          entries.map((e) => (
            <li
              key={`${e.id}-${e.timestamp}`}
              className="rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                  {e.type}
                </span>
                <span className="text-xs text-zinc-500">{e.timestamp}</span>
                {e.impact_measured != null ? (
                  <span className="text-xs text-zinc-500">
                    impact: {e.impact_measured.toFixed(3)}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 leading-relaxed">{e.description}</p>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
