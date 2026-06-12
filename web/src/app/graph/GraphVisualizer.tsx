"use client";

import { useEffect, useRef, useState } from "react";
import { ForceGraph } from "@/components/ForceGraph";

type Props = {
  nodes: { id: string; label: string; type: string; weight: number }[];
  edges: { source: string; target: string; type: string; weight?: number }[];
};

export function GraphVisualizer({ nodes, edges }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver(([e]) => {
      if (e) setW(Math.floor(e.contentRect.width));
    });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const visible = nodes.length > 120
    ? [...nodes].sort((a, b) => b.weight - a.weight).slice(0, 120)
    : nodes;
  const ids = new Set(visible.map((n) => n.id));
  const filteredEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));

  return (
    <div ref={ref}>
      <ForceGraph nodes={visible} edges={filteredEdges} width={w} height={560} />
    </div>
  );
}
