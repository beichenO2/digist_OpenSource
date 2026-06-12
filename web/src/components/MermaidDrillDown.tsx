"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
}

function findNode(tree: TreeNode, id: string): TreeNode | null {
  if (tree.id === id) return tree;
  for (const c of tree.children ?? []) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

function pathToNode(tree: TreeNode, targetId: string): string[] {
  function walk(n: TreeNode, acc: string[]): string[] {
    const next = [...acc, n.id];
    if (n.id === targetId) return next;
    for (const c of n.children ?? []) {
      const p = walk(c, next);
      if (p.length) return p;
    }
    return [];
  }
  return walk(tree, []);
}

function escapeMermaidLabel(s: string): string {
  return s.replace(/"/g, "#quot;").replace(/\n/g, " ");
}

function mid(id: string): string {
  return `n_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function toMermaidSource(focus: TreeNode): {
  source: string;
  childByMid: Map<string, TreeNode>;
} {
  const childByMid = new Map<string, TreeNode>();
  const lines = ["flowchart TB"];
  const rootId = mid(focus.id);
  lines.push(`  ${rootId}["${escapeMermaidLabel(focus.label)}"]`);

  const kids = focus.children ?? [];
  for (const child of kids) {
    const cid = mid(child.id);
    childByMid.set(cid, child);
    lines.push(`  ${cid}["${escapeMermaidLabel(child.label)}"]`);
    lines.push(`  ${rootId} --> ${cid}`);
  }

  for (const child of kids) {
    const hasGrand = (child.children?.length ?? 0) > 0;
    const cid = mid(child.id);
    if (hasGrand) {
      lines.push(`  style ${cid} fill:#7dd3fc,stroke:#0369a1`);
    } else {
      lines.push(`  style ${cid} fill:#6ee7b7,stroke:#047857`);
    }
  }

  return { source: lines.join("\n"), childByMid };
}

interface MermaidDrillDownProps {
  tree: TreeNode;
  onSelectLeaf?: (node: TreeNode) => void;
}

export function MermaidDrillDown({ tree, onSelectLeaf }: MermaidDrillDownProps) {
  const [focusId, setFocusId] = useState(tree.id);
  const hostRef = useRef<HTMLDivElement>(null);
  const childMapRef = useRef<Map<string, TreeNode>>(new Map());
  const [renderKey, setRenderKey] = useState(0);

  useEffect(() => {
    setFocusId(tree.id);
  }, [tree]);

  const handleSvgClick = useCallback(
    (e: Event) => {
      const me = e as MouseEvent;
      let el = me.target as Element | null;
      if (el instanceof Text) el = el.parentElement;
      if (!el) return;

      const svg = hostRef.current?.querySelector("svg");
      if (!svg) return;

      while (el && el !== svg) {
        if (el.tagName === "g" && el.id) {
          for (const [mId, child] of childMapRef.current) {
            if (el.id.includes(mId)) {
              me.preventDefault();
              me.stopPropagation();
              if (child.children?.length) {
                setFocusId(child.id);
                setRenderKey((k) => k + 1);
              } else {
                onSelectLeaf?.(child);
              }
              return;
            }
          }
        }
        el = el.parentElement;
      }
    },
    [onSelectLeaf],
  );

  const render = useCallback(async () => {
    if (!hostRef.current) return;
    const focus = findNode(tree, focusId);
    if (!focus) return;

    const { source, childByMid } = toMermaidSource(focus);
    childMapRef.current = childByMid;

    hostRef.current.innerHTML = "";
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    pre.textContent = source;
    hostRef.current.appendChild(pre);

    try {
      const mermaid = (await import("mermaid")).default;
      await mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: document.documentElement.classList.contains("dark")
          ? "dark"
          : "default",
        flowchart: { useMaxWidth: true, htmlLabels: true },
      });
      await mermaid.run({
        querySelector: "#mermaid-drill-host pre.mermaid",
      });

      const svg = hostRef.current.querySelector("svg");
      if (svg) {
        svg.style.cursor = "pointer";
        svg.addEventListener("click", handleSvgClick);
      }
    } catch (err) {
      console.error("Mermaid render error:", err);
      hostRef.current.innerHTML = `<p class="text-red-500 text-sm">Mermaid render failed</p>`;
    }
  }, [tree, focusId, handleSvgClick]);

  useEffect(() => {
    render();
  }, [render, renderKey]);

  const path = pathToNode(tree, focusId);
  const crumbs = path.map((id) => {
    const node = findNode(tree, id);
    return { id, label: node?.label ?? id };
  });

  return (
    <div className="space-y-3">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={c.id} className="flex items-center gap-1">
              {i > 0 && (
                <span className="text-zinc-400">/</span>
              )}
              {isLast ? (
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {c.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setFocusId(c.id);
                    setRenderKey((k) => k + 1);
                  }}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {c.label}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ background: "#7dd3fc" }} />
          Click to drill down
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ background: "#6ee7b7" }} />
          Leaf node
        </span>
      </div>

      {/* Mermaid host */}
      <div
        id="mermaid-drill-host"
        ref={hostRef}
        className="min-h-[200px] overflow-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
      />
    </div>
  );
}
