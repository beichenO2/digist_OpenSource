"use client";

import { useState, useEffect, useCallback } from "react";

type KnowledgeGap = {
  type: "isolated-node" | "sparse-community" | "bridge-node";
  title: string;
  description: string;
  nodeIds: string[];
  suggestion: string;
};

const typeLabel: Record<string, string> = {
  "isolated-node": "孤立节点",
  "sparse-community": "稀疏社区",
  "bridge-node": "桥接节点",
};

const typeColor: Record<string, string> = {
  "isolated-node": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "sparse-community": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "bridge-node": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

export default function ResearchPage() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [message, setMessage] = useState("");

  const loadGaps = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await fetch("/api/digist/research");
      const data = await resp.json();
      setGaps(data.gaps || []);
    } catch (err) {
      setMessage(`加载失败: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGaps();
  }, [loadGaps]);

  const triggerResearch = async () => {
    try {
      setTriggering(true);
      setMessage("");
      const resp = await fetch("/api/digist/research", { method: "POST" });
      const data = await resp.json();
      if (data.status === "no_gaps") {
        setMessage("未检测到知识缺口，无需研究");
      } else {
        setMessage(`深度研究已启动：${data.gaps_count} 个知识缺口正在自动填补`);
      }
      setTimeout(loadGaps, 5000);
    } catch (err) {
      setMessage(`触发失败: ${err}`);
    } finally {
      setTriggering(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">深度研究</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            检测知识图谱中的缺口，通过 Firecrawl + LLM 自动搜索 Web 补充信息
          </p>
        </div>
        <button
          onClick={triggerResearch}
          disabled={triggering || gaps.length === 0}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {triggering ? "研究中..." : "启动深度研究"}
        </button>
      </div>

      {message && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          {message}
        </div>
      )}

      <div className="mt-4 flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
        <span>
          共 {gaps.length} 个知识缺口
        </span>
        <button onClick={loadGaps} className="text-emerald-600 hover:underline dark:text-emerald-400">
          刷新
        </button>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-zinc-400">加载中...</div>
      ) : gaps.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-zinc-300 p-12 text-center text-zinc-500 dark:border-zinc-700">
          <p className="text-lg">暂无知识缺口</p>
          <p className="mt-2 text-sm">知识图谱覆盖良好，或尚未有足够内容构建图谱。</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {gaps.map((gap, i) => (
            <div
              key={i}
              className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start gap-3">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${typeColor[gap.type] || ""}`}>
                  {typeLabel[gap.type] || gap.type}
                </span>
                <div className="flex-1">
                  <h3 className="font-medium">{gap.title}</h3>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {gap.description}
                  </p>
                  <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                    {gap.suggestion}
                  </p>
                  {gap.nodeIds.length > 0 && (
                    <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
                      相关节点: {gap.nodeIds.slice(0, 5).join(", ")}
                      {gap.nodeIds.length > 5 && ` +${gap.nodeIds.length - 5}`}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="mt-12">
        <h2 className="text-lg font-medium">架构说明</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-4">
          {[
            { step: "1", title: "Gap 检测", desc: "知识图谱孤立节点 / 稀疏社区 / 桥接节点分析" },
            { step: "2", title: "LLM 规划", desc: "生成领域感知搜索查询（参考 GPT Researcher）" },
            { step: "3", title: "Web 搜索", desc: "Firecrawl 并行搜索 + 去重" },
            { step: "4", title: "反思循环", desc: "LLM 评估结果充分性，不足则迭代（参考 Tavily）" },
          ].map((s) => (
            <div
              key={s.step}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  {s.step}
                </span>
                <span className="font-medium text-sm">{s.title}</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
