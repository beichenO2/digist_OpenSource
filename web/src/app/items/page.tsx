import { getStorage } from "@/lib/digist-data";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  const sp = await searchParams;
  const platform = sp.platform;
  const s = getStorage();
  const items = s.listContent(platform, 80, 0);
  const platforms = [
    "twitter",
    "reddit",
    "wechat",
    "github",
    "glass",
    "other",
  ] as const;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">采集条目</h1>
        <p className="text-sm text-zinc-500">最近 80 条 · 按时间倒序</p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <FilterChip href="/items" active={!platform} label="全部" />
        {platforms.map((p) => (
          <FilterChip key={p} href={`/items?platform=${p}`} active={platform === p} label={p} />
        ))}
      </div>

      <ul className="mt-8 space-y-4">
        {items.length === 0 ? (
          <li className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
            暂无数据。运行{" "}
            <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-800">
              npx tsx src/cli.ts scrape ...
            </code>{" "}
            或配置定时任务。
          </li>
        ) : (
          items.map((it) => (
            <li
              key={it.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-medium leading-snug">{it.title}</h2>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {it.platform}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                {it.body_markdown.replace(/[#*`]/g, "").slice(0, 280)}
                {it.body_markdown.length > 280 ? "…" : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-500">
                <span>{it.timestamp}</span>
                {it.author ? <span>作者: {it.author}</span> : null}
                <Link
                  href={it.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  原文
                </Link>
              </div>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}

function FilterChip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-sm transition ${
        active
          ? "bg-emerald-600 text-white dark:bg-emerald-500"
          : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }`}
    >
      {label}
    </Link>
  );
}
