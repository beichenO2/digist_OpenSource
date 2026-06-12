import Link from "next/link";

const links = [
  { href: "/", label: "概览" },
  { href: "/items", label: "采集条目" },
  { href: "/graph", label: "知识图谱" },
  { href: "/reports", label: "融合报告" },
  { href: "/evolution", label: "进化日志" },
  { href: "/scheduler", label: "调度任务" },
  { href: "/research", label: "深度研究" },
];

export function Nav() {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-emerald-600 dark:text-emerald-400"
        >
          DiGist
        </Link>
        <span className="text-zinc-400 dark:text-zinc-600">|</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-zinc-600 transition hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
