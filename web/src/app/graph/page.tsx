import { buildSimpleGraph, topNodes } from "@/lib/simple-graph";
import { getStorage } from "@/lib/digist-data";
import { GraphVisualizer } from "./GraphVisualizer";

export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const s = getStorage();
  const items = s.listContent(undefined, 200, 0);
  const lite = items.map((it) => ({
    id: it.id,
    title: it.title,
    platform: it.platform,
    source_url: it.source_url,
    timestamp: it.timestamp,
  }));
  const { stats, nodes, edges } = buildSimpleGraph(lite);
  const hubs = topNodes(nodes, 15);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold">知识图谱</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        基于最近 {items.length} 条采集内容的<strong>平台–来源</strong>交互式图谱。
        拖拽节点、滚轮缩放、悬停查看详情。JSON 见{" "}
        <a className="text-emerald-600 hover:underline dark:text-emerald-400" href="/api/graph">
          /api/graph
        </a>
        。
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat label="节点" value={stats.nodes} />
        <Stat label="边" value={stats.edges} />
        <Stat label="类型" value={`${Object.keys(stats.by_type).length} 类`} />
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        {Object.entries(stats.by_type).map(([k, v]) => (
          <span key={k} className="rounded bg-zinc-200 px-2 py-0.5 dark:bg-zinc-800">
            {k}: {v}
          </span>
        ))}
      </div>

      <section className="mt-8">
        <GraphVisualizer nodes={nodes} edges={edges} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Hub 节点（按权重）</h2>
        <ul className="mt-4 space-y-2">
          {hubs.map((n) => (
            <li
              key={n.id}
              className="flex justify-between gap-4 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="truncate font-mono text-xs text-zinc-500">{n.id}</span>
              <span className="truncate text-right">{n.label}</span>
              <span className="shrink-0 tabular-nums text-zinc-500">{n.weight}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
