import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/digist-paths";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string }>;
}) {
  const sp = await searchParams;
  const reportDir = join(getDataDir(), "reports");
  let files: string[] = [];
  if (existsSync(reportDir)) {
    files = readdirSync(reportDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();
  }

  const selected = sp.file && files.includes(sp.file) ? sp.file : files[0] ?? null;
  let markdown = "";
  if (selected) {
    try {
      markdown = readFileSync(join(reportDir, selected), "utf-8");
    } catch {
      markdown = "（无法读取文件）";
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold">融合报告</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        展示引擎写入{" "}
        <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-800">data/reports/</code>{" "}
        的 Markdown 报告；亦可通过{" "}
        <Link className="text-emerald-600 hover:underline dark:text-emerald-400" href="/api/digist/reports">
          /api/digist/reports
        </Link>{" "}
        拉取 JSON。
      </p>

      {files.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          暂无落盘报告。运行 DiGist 引擎生成融合报告后会出现在此目录。
        </p>
      ) : (
        <div className="mt-8 flex flex-col gap-6 lg:flex-row">
          <aside className="lg:w-56 shrink-0">
            <p className="text-xs font-medium uppercase text-zinc-500">文件</p>
            <ul className="mt-2 space-y-1">
              {files.map((f) => (
                <li key={f}>
                  <Link
                    href={`/reports?file=${encodeURIComponent(f)}`}
                    className={`block truncate rounded px-2 py-1 text-sm ${
                      selected === f
                        ? "bg-emerald-600 text-white dark:bg-emerald-600"
                        : "hover:bg-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {f}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
          <article className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            {selected ? (
              <>
                <h2 className="font-mono text-sm text-zinc-500">{selected}</h2>
                <pre className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {markdown}
                </pre>
              </>
            ) : null}
          </article>
        </div>
      )}
    </main>
  );
}
