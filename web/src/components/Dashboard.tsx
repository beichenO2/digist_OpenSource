"use client";

import { useCallback, useEffect, useState } from "react";
import { MermaidDrillDown, type TreeNode } from "./MermaidDrillDown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

type Tab = "overview" | "content" | "graph" | "wiki" | "reports" | "evolution" | "scheduler" | "tasks";

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [tick, setTick] = useState(0);
  const poll = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [poll]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-zinc-200 bg-white/80 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              DiGist 控制台
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              采集内容 · 知识图谱 · 融合报告 · 进化日志 · 调度与集成
            </p>
          </div>
          <nav className="flex flex-wrap gap-1 text-sm">
            {(
              [
                ["overview", "概览"],
                ["content", "采集内容"],
                ["graph", "知识图谱"],
                ["wiki", "Wiki"],
                ["reports", "融合报告"],
                ["evolution", "进化日志"],
                ["scheduler", "调度中心"],
                ["tasks", "操作中心"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-full px-3 py-1.5 transition-colors ${
                  tab === id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {tab === "overview" && <OverviewPanel key={tick} />}
        {tab === "content" && <ContentPanel key={tick} />}
        {tab === "graph" && <GraphPanel key={tick} />}
        {tab === "wiki" && <WikiPanel key={tick} />}
        {tab === "reports" && <ReportsPanel />}
        {tab === "evolution" && <EvolutionPanel key={tick} />}
        {tab === "scheduler" && <SchedulerPanel key={tick} />}
        {tab === "tasks" && <TasksPanel key={tick} />}
      </main>

      <footer className="border-t border-zinc-200 px-6 py-3 text-center text-xs text-zinc-400 dark:border-zinc-800">
        数据目录：父级仓库 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">data/</code> ·
        每 30 秒自动刷新当前页数据
      </footer>
    </div>
  );
}

function OverviewPanel() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/digist/overview")
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        if (!r.ok) {
          setErr(`请求失败 HTTP ${r.status}`);
          return;
        }
        if (!d || typeof d !== "object") {
          setErr("响应无效");
          return;
        }
        if (!d.ok) {
          setErr(String(d.error ?? "概览接口返回错误"));
          return;
        }
        setData(d);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="text-red-600">{err}</p>;
  if (!data) return <p className="text-zinc-500">加载中…</p>;

  const byPlatform = (data.byPlatform as Record<string, number>) ?? {};
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard title="内容条数" value={String(data.contentTotal)} />
      <StatCard title="定时任务" value={`${data.jobsEnabled} / ${data.jobsTotal} 启用`} />
      <StatCard title="融合报告文件" value={String(data.reportFiles)} />
      <StatCard title="进化日志条目" value={String(data.evolutionEntries)} />
      <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          平台分布（样本内）
        </h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byPlatform).map(([k, v]) => (
            <span
              key={k}
              className="rounded-md bg-white px-2 py-1 text-sm shadow-sm dark:bg-zinc-950"
            >
              {k}: <strong>{v}</strong>
            </span>
          ))}
          {Object.keys(byPlatform).length === 0 && (
            <span className="text-sm text-zinc-500">暂无样本</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
    </div>
  );
}

function ContentPanel() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<unknown[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    const url = q.trim()
      ? `/api/digist/content?q=${encodeURIComponent(q.trim())}&limit=40`
      : "/api/digist/content?limit=40";
    fetch(url)
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        if (!r.ok) {
          setErr(`请求失败 HTTP ${r.status}`);
          setRows([]);
          setTotal(0);
          return;
        }
        if (!d || typeof d !== "object") {
          setErr("响应无效");
          setRows([]);
          setTotal(0);
          return;
        }
        if (!d.ok) {
          setErr(String(d.error ?? "内容接口返回错误"));
          setRows([]);
          setTotal(0);
          return;
        }
        setRows((d.items as unknown[]) ?? []);
        setTotal((d.total as number) ?? (d.items as unknown[])?.length ?? 0);
      })
      .catch((e) => {
        setErr(String(e));
        setRows([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [q]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          placeholder="全文搜索（FTS）…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button
          type="button"
          onClick={load}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          搜索
        </button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {loading ? (
        <p className="text-zinc-500">加载中…</p>
      ) : (
        !err && (
          <p className="text-sm text-zinc-500">共约 {total} 条 · 当前显示 {rows.length} 条</p>
        )
      )}
      <ul className="space-y-3">
        {rows.map((item: unknown) => {
          const it = item as {
            id: string;
            title: string;
            platform: string;
            timestamp: string;
            source_url: string;
            body_markdown: string;
          };
          return (
            <li
              key={it.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase text-zinc-400">{it.platform}</span>
                <time className="text-xs text-zinc-400">{it.timestamp}</time>
              </div>
              <h3 className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{it.title}</h3>
              <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                {it.body_markdown}
              </p>
              <a
                href={it.source_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                {it.source_url}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GraphPanel() {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLeaf, setSelectedLeaf] = useState<TreeNode | null>(null);
  const [wikiContent, setWikiContent] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/digist/wiki-tree")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setTree(data.tree);
        else setError(data.error);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const handleSelectLeaf = useCallback((node: TreeNode) => {
    setSelectedLeaf(node);
    const slug = node.id.replace(/^item-/, "").replace(/^topic-/, "");
    fetch(`/api/digist/wiki/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setWikiContent(data.page.content);
        else setWikiContent(`_No wiki page found for "${node.label}"_`);
      })
      .catch(() => setWikiContent(null));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!tree) return <p className="text-zinc-500">Loading knowledge tree...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-medium">Knowledge Map (Mermaid Drill-Down)</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Click blue nodes to drill down, green nodes are leaf items. Breadcrumb to navigate back.
        </p>
        <MermaidDrillDown tree={tree} onSelectLeaf={handleSelectLeaf} />
      </div>

      {selectedLeaf && wikiContent && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <h4 className="mb-2 text-sm font-medium">{selectedLeaf.label}</h4>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{wikiContent}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function WikiPanel() {
  const [pages, setPages] = useState<Array<{ slug: string; title: string; sources: number; updated_at: string }>>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");

  useEffect(() => {
    fetch("/api/digist/wiki-tree")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok || !data.tree?.children) return;
        const topics = data.tree.children
          .filter((c: TreeNode) => c.id.startsWith("topic-"))
          .map((c: TreeNode) => ({
            slug: c.id.replace("topic-", ""),
            title: c.label,
            sources: 0,
            updated_at: "",
          }));
        setPages(topics);
        setSelectedSlug((current) => current ?? topics[0]?.slug ?? null);
      });
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    fetch(`/api/digist/wiki/${selectedSlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setContent(data.page.content);
        else setContent(`*Page "${selectedSlug}" not yet compiled.*`);
      })
      .catch(() => setContent("Failed to load wiki page."));
  }, [selectedSlug]);

  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0">
        <h3 className="mb-2 text-sm font-medium">Wiki Pages</h3>
        <ul className="space-y-1 text-sm">
          {pages.length === 0 && (
            <li className="text-zinc-400">No wiki pages yet. Run the pipeline to compile.</li>
          )}
          {pages.map((p) => (
            <li key={p.slug}>
              <button
                type="button"
                onClick={() => setSelectedSlug(p.slug)}
                className={`w-full rounded px-2 py-1 text-left transition-colors ${
                  selectedSlug === p.slug
                    ? "bg-zinc-100 font-medium dark:bg-zinc-800"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
              >
                {p.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="min-w-0 flex-1">
        {content ? (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-zinc-400">Select a wiki page from the sidebar.</p>
        )}
      </div>
    </div>
  );
}

function ReportsPanel() {
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([]);

  useEffect(() => {
    fetch("/api/digist/reports")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.files?.length) {
          setFiles(d.files);
          setName(d.files[0]);
        }
      });
  }, []);

  useEffect(() => {
    if (!name) return;
    fetch(`/api/digist/reports?name=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setContent(d.content ?? "");
          const headings: { id: string; text: string; level: number }[] = [];
          const lines = (d.content ?? "").split("\n");
          for (const line of lines) {
            const match = line.match(/^(#{1,3})\s+(.+)/);
            if (match) {
              const text = match[2].trim();
              const id = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-");
              headings.push({ id, text, level: match[1].length });
            }
          }
          setToc(headings);
        }
      });
  }, [name]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-zinc-600 dark:text-zinc-400">选择报告</label>
        <select
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={name ?? ""}
          onChange={(e) => setName(e.target.value || null)}
        >
          {files.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      {files.length === 0 && <p className="text-zinc-500">暂无 Markdown 报告（data/reports）</p>}
      {content && (
        <div className="flex gap-6">
          {toc.length > 2 && (
            <nav className="hidden w-48 shrink-0 lg:block">
              <div className="sticky top-4 space-y-1 text-xs">
                <p className="mb-2 font-medium text-zinc-500">目录</p>
                {toc.map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    className="block truncate text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                    style={{ paddingLeft: (h.level - 1) * 12 }}
                  >
                    {h.text}
                  </a>
                ))}
              </div>
            </nav>
          )}
          <article className="prose prose-sm dark:prose-invert max-w-none flex-1 rounded-xl border border-zinc-200 bg-zinc-50/50 p-6 dark:border-zinc-800 dark:bg-zinc-900/30">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children, ...props }) => {
                  const text = String(children);
                  const id = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-");
                  return <h1 id={id} {...props}>{children}</h1>;
                },
                h2: ({ children, ...props }) => {
                  const text = String(children);
                  const id = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-");
                  return <h2 id={id} {...props}>{children}</h2>;
                },
                h3: ({ children, ...props }) => {
                  const text = String(children);
                  const id = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-");
                  return <h3 id={id} {...props}>{children}</h3>;
                },
                code: ({ className, children, ...props }) => {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-700" {...props}>
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className={`${className} block overflow-x-auto rounded-lg bg-zinc-900 p-4 text-xs text-zinc-100 dark:bg-zinc-950`} {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
        </div>
      )}
    </div>
  );
}

function EvolutionPanel() {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([]);
  const [view, setView] = useState<"timeline" | "chart">("timeline");

  useEffect(() => {
    fetch("/api/digist/evolution?tail=200")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setEntries(d.entries ?? []);
      });
  }, []);

  if (entries.length === 0) {
    return <p className="text-zinc-500">暂无进化日志（data/evolution/evolution.jsonl）</p>;
  }

  const typeCount: Record<string, number> = {};
  const timelineData: { time: string; score: number; idx: number }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const t = String(e.type ?? "unknown");
    typeCount[t] = (typeCount[t] ?? 0) + 1;
    const score = Number(e.score ?? e.confidence ?? e.quality ?? 0);
    const ts = String(e.timestamp ?? "").slice(0, 16);
    timelineData.push({ time: ts, score, idx: i });
  }

  const barData = Object.entries(typeCount)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-500">{entries.length} 条进化记录</span>
        <div className="ml-auto flex gap-1">
          {(["timeline", "chart"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                view === v
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {v === "timeline" ? "时间线" : "趋势图"}
            </button>
          ))}
        </div>
      </div>

      {view === "chart" && (
        <div className="space-y-6">
          {timelineData.some((d) => d.score > 0) && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <h3 className="mb-3 text-sm font-medium">评分趋势</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis dataKey="idx" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    labelFormatter={(v) => `#${v}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-3 text-sm font-medium">事件类型分布</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {view === "timeline" && (
        <ul className="space-y-3">
          {[...entries].reverse().map((e, i) => (
            <li
              key={i}
              className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                <span>{String(e.timestamp ?? "")}</span>
                <span className="rounded bg-zinc-100 px-1.5 dark:bg-zinc-800">
                  {String(e.type ?? "")}
                </span>
                {(e.score ?? e.confidence ?? e.quality) != null && Number(e.score ?? e.confidence ?? e.quality) > 0 ? (
                  <span className="rounded bg-indigo-100 px-1.5 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                    score: {String(e.score ?? e.confidence ?? e.quality)}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-zinc-800 dark:text-zinc-200">{String(e.description ?? "")}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SchedulerPanel() {
  const [sched, setSched] = useState<Record<string, unknown> | null>(null);
  const [integ, setInteg] = useState<Record<string, unknown> | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [rateHistory, setRateHistory] = useState<{ time: string; items: number }[]>([]);

  const loadData = useCallback(() => {
    Promise.all([
      fetch("/api/digist/scheduler").then((r) => r.json()),
      fetch("/api/digist/integrations").then((r) => r.json()),
    ]).then(([a, b]) => {
      setSched(a);
      setInteg(b);
      const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLastRefresh(now);
      const total = Number(a?.stats?.contentTotal ?? 0);
      setRateHistory((prev) => {
        const next = [...prev, { time: now, items: total }].slice(-20);
        return next;
      });
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(loadData, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, loadData]);

  if (!sched?.ok) return <p className="text-zinc-500">加载调度数据…</p>;

  const jobs = (sched.jobs as Record<string, unknown>[]) ?? [];
  const stats = sched.stats as Record<string, unknown>;
  const enabledJobs = jobs.filter((j) => j.enabled);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            系统状态仪表盘
          </h3>
          <p className="text-xs text-zinc-500">
            上次刷新：{lastRefresh || "—"} · {autoRefresh ? "自动刷新 15s" : "已暂停"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              autoRefresh
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {autoRefresh ? "自动刷新中" : "已暂停"}
          </button>
          <button
            type="button"
            onClick={loadData}
            className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            刷新
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="内容总数" value={String(stats?.contentTotal ?? 0)} />
        <StatCard title="采集任务" value={`${enabledJobs.length} / ${jobs.length} 启用`} />
        <StatCard title="Glass 样本" value={String(stats?.glassItemsInSample ?? 0)} />
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">集成状态</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge label="Glass" ok={Number(stats?.glassItemsInSample ?? 0) > 0} />
          </div>
        </div>
      </div>

      {rateHistory.length > 1 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="mb-3 text-sm font-medium">采集量实时趋势</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={rateHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="time" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="items" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div>
        <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          采集任务明细
        </h3>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="p-2">状态</th>
                <th className="p-2">平台</th>
                <th className="p-2">查询</th>
                <th className="p-2">Cron</th>
                <th className="p-2">上次运行</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-zinc-500">暂无任务</td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={String(j.id)} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="p-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${j.enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
                    </td>
                    <td className="p-2 font-mono text-xs">{String(j.platform)}</td>
                    <td className="p-2">{String(j.query) || "—"}</td>
                    <td className="p-2 font-mono text-xs">{String(j.cron)}</td>
                    <td className="p-2 text-xs text-zinc-500">{String(j.lastRunAt ?? "从未运行")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {integ != null && integ.ok === true && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <h3 className="mb-2 text-sm font-medium">Glass 屏幕监控</h3>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              <p>导入样本：{String(stats?.glassItemsInSample ?? 0)} 条</p>
              <p className="mt-2 text-zinc-500">
                {String((integ.glass as { hint?: string })?.hint ?? "")}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type TaskRow = {
  id?: string;
  type?: string;
  status?: string;
  created_at?: string;
  error?: string;
  result?: unknown;
};

function TasksPanel() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [crawlPlatform, setCrawlPlatform] = useState("twitter");
  const [crawlQuery, setCrawlQuery] = useState("");
  const [prepFile, setPrepFile] = useState("");
  const [prepType, setPrepType] = useState<"pdf" | "audio" | "video">("pdf");
  const [prepDomain, setPrepDomain] = useState("general");
  const [msg, setMsg] = useState("");

  const loadTasks = useCallback(() => {
    fetch("/api/digist/tasks").then(r => r.json()).then(d => { if (d.ok) setTasks(d.tasks); });
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const postAction = useCallback(async (url: string, body: Record<string, unknown>) => {
    setMsg("Submitting...");
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      setMsg(d.ok ? `Task created: ${d.task?.id}` : `Error: ${d.error}`);
      loadTasks();
    } catch (e) { setMsg(`Error: ${e}`); }
  }, [loadTasks]);

  const STATUS_COLORS: Record<string, string> = {
    queued: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };

  return (
    <div className="space-y-6">
      {msg && <p className="rounded bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">{msg}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Crawl */}
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-3 text-sm font-medium">Crawl</h3>
          <select value={crawlPlatform} onChange={e => setCrawlPlatform(e.target.value)} className="mb-2 w-full rounded border px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            {["twitter", "reddit", "github", "hackernews", "arxiv", "wechat", "bilibili", "xiaohongshu"].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input value={crawlQuery} onChange={e => setCrawlQuery(e.target.value)} placeholder="Search query" className="mb-2 w-full rounded border px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          <button onClick={() => postAction("/api/digist/tasks", { type: "crawl", params: { platform: crawlPlatform, query: crawlQuery } })} className="w-full rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            Start Crawl
          </button>
        </div>

        {/* Compile Wiki */}
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-3 text-sm font-medium">Compile Wiki</h3>
          <p className="mb-3 text-xs text-zinc-500">Compile raw data into structured wiki pages using local LLM</p>
          <button onClick={() => postAction("/api/digist/tasks", { type: "compile_wiki", params: {} })} className="w-full rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            Compile Now
          </button>
        </div>

        {/* Generate Report */}
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-3 text-sm font-medium">Fusion Report</h3>
          <p className="mb-3 text-xs text-zinc-500">Generate a cross-source intelligence report</p>
          <button onClick={() => postAction("/api/digist/tasks", { type: "generate_report", params: {} })} className="w-full rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            Generate Report
          </button>
        </div>

        {/* Preprocess */}
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-3 text-sm font-medium">Preprocess File</h3>
          <input value={prepFile} onChange={e => setPrepFile(e.target.value)} placeholder="File path" className="mb-2 w-full rounded border px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          <div className="mb-2 flex gap-2">
            <select value={prepType} onChange={e => setPrepType(e.target.value as "pdf" | "audio" | "video")} className="flex-1 rounded border px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              <option value="pdf">PDF</option>
              <option value="audio">Audio</option>
              <option value="video">Video</option>
            </select>
            <select value={prepDomain} onChange={e => setPrepDomain(e.target.value)} className="flex-1 rounded border px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              <option value="general">General</option>
              <option value="medical">Medical</option>
              <option value="academic">Academic</option>
              <option value="tech">Tech</option>
              <option value="finance">Finance</option>
            </select>
          </div>
          <button onClick={() => postAction("/api/digist/tasks", { type: "preprocess", params: { file: prepFile, type: prepType, domain: prepDomain } })} className="w-full rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            Preprocess
          </button>
        </div>
      </div>

      {/* Task Queue */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Task Queue</h3>
          <button onClick={loadTasks} className="text-xs text-blue-600 hover:underline dark:text-blue-400">Refresh</button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="p-2">ID</th>
                <th className="p-2">Type</th>
                <th className="p-2">Status</th>
                <th className="p-2">Created</th>
                <th className="p-2">Result / Error</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-zinc-400">No tasks yet</td></tr>
              )}
              {tasks.map((t) => {
                const status = t.status ?? "unknown";
                return (
                  <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="p-2 font-mono text-xs">{t.id?.slice(0, 8)}</td>
                    <td className="p-2">{t.type}</td>
                    <td className="p-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] || ""}`}>
                        {status}
                      </span>
                    </td>
                    <td className="p-2 text-xs text-zinc-500">{t.created_at?.slice(0, 19)}</td>
                    <td className="p-2 text-xs">{t.error ? <span className="text-red-500">{t.error}</span> : t.result ? JSON.stringify(t.result).slice(0, 60) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
      ok
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
    }`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-zinc-400"}`} />
      {label}
    </span>
  );
}
