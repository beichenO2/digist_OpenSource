"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type GNode = {
  id: string;
  label: string;
  type: string;
  weight: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
};

type GEdge = { source: string; target: string; type: string; weight: number };

type Props = {
  nodes: { id: string; label: string; type: string; weight: number }[];
  edges: { source: string; target: string; type: string; weight?: number }[];
  width?: number;
  height?: number;
};

const TYPE_COLORS: Record<string, string> = {
  platform: "#10b981",
  source: "#6366f1",
  entity: "#f59e0b",
  topic: "#ec4899",
};
const DEFAULT_COLOR = "#71717a";

function color(type: string) {
  return TYPE_COLORS[type] ?? DEFAULT_COLOR;
}

function radius(n: GNode) {
  return Math.max(6, Math.min(28, 6 + n.weight * 1.8));
}

export function ForceGraph({ nodes: rawNodes, edges: rawEdges, width = 800, height = 520 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<GNode[]>([]);
  const edgesRef = useRef<GEdge[]>([]);
  const frameRef = useRef(0);
  const [, rerender] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const [offset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const idx = new Map<string, number>();
    const ns: GNode[] = rawNodes.map((n, i) => {
      idx.set(n.id, i);
      const angle = (2 * Math.PI * i) / rawNodes.length;
      const spread = Math.min(width, height) * 0.35;
      return {
        ...n,
        x: width / 2 + Math.cos(angle) * spread * (0.5 + Math.random() * 0.5),
        y: height / 2 + Math.sin(angle) * spread * (0.5 + Math.random() * 0.5),
        vx: 0,
        vy: 0,
      };
    });
    const es: GEdge[] = rawEdges
      .filter((e) => idx.has(e.source) && idx.has(e.target))
      .map((e) => ({ ...e, weight: e.weight ?? 1 }));
    nodesRef.current = ns;
    edgesRef.current = es;
    rerender((c) => c + 1);
  }, [rawNodes, rawEdges, width, height]);

  const tick = useCallback(() => {
    const ns = nodesRef.current;
    const es = edgesRef.current;
    if (!ns.length) return;

    const cx = width / 2;
    const cy = height / 2;
    const REPULSION = 3200;
    const SPRING = 0.008;
    const REST_LEN = 90;
    const GRAVITY = 0.012;
    const DAMPING = 0.88;

    for (let i = 0; i < ns.length; i++) {
      const a = ns[i];
      if (a.pinned) continue;
      a.vx += (cx - a.x) * GRAVITY;
      a.vy += (cy - a.y) * GRAVITY;
      for (let j = i + 1; j < ns.length; j++) {
        const b = ns[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist2 = dx * dx + dy * dy + 1;
        const f = REPULSION / dist2;
        const dist = Math.sqrt(dist2);
        dx /= dist;
        dy /= dist;
        if (!a.pinned) { a.vx += dx * f; a.vy += dy * f; }
        if (!b.pinned) { b.vx -= dx * f; b.vy -= dy * f; }
      }
    }

    const idxMap = new Map<string, number>();
    for (let i = 0; i < ns.length; i++) idxMap.set(ns[i].id, i);

    for (const e of es) {
      const ai = idxMap.get(e.source);
      const bi = idxMap.get(e.target);
      if (ai == null || bi == null) continue;
      const a = ns[ai];
      const b = ns[bi];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (dist - REST_LEN) * SPRING;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      if (!a.pinned) { a.vx += fx; a.vy += fy; }
      if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
    }

    for (const n of ns) {
      if (n.pinned) continue;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    }
    rerender((c) => c + 1);
  }, [width, height]);

  useEffect(() => {
    let running = true;
    let iterations = 0;
    const MAX = 400;
    function loop() {
      if (!running || iterations++ > MAX) return;
      tick();
      frameRef.current = requestAnimationFrame(loop);
    }
    loop();
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [tick]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.max(0.2, Math.min(4, s - e.deltaY * 0.001)));
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const n = nodesRef.current.find((n) => n.id === id);
    if (n) {
      n.pinned = true;
      dragRef.current = { id, ox: e.clientX - n.x * scale, oy: e.clientY - n.y * scale };
    }
  }, [scale]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const n = nodesRef.current.find((n) => n.id === dragRef.current!.id);
    if (n) {
      n.x = (e.clientX - dragRef.current.ox) / scale;
      n.y = (e.clientY - dragRef.current.oy) / scale;
      rerender((c) => c + 1);
    }
  }, [scale]);

  const onPointerUp = useCallback(() => {
    if (dragRef.current) {
      const n = nodesRef.current.find((n) => n.id === dragRef.current!.id);
      if (n) n.pinned = false;
      dragRef.current = null;
    }
  }, []);

  const ns = nodesRef.current;
  const es = edgesRef.current;
  const idxMap = new Map<string, GNode>();
  for (const n of ns) idxMap.set(n.id, n);

  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full"
        viewBox={`${-offset.x} ${-offset.y} ${width / scale} ${height / scale}`}
        onWheel={onWheel}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ touchAction: "none" }}
      >
        <g>
          {es.map((e, i) => {
            const a = idxMap.get(e.source);
            const b = idxMap.get(e.target);
            if (!a || !b) return null;
            const isHl = hovered === e.source || hovered === e.target;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isHl ? "#3b82f6" : "#d4d4d8"}
                strokeWidth={isHl ? 1.5 : 0.6}
                strokeOpacity={isHl ? 0.9 : 0.4}
              />
            );
          })}
        </g>
        <g>
          {ns.map((n) => {
            const r = radius(n);
            const isHl = hovered === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                onPointerDown={(e) => onPointerDown(e, n.id)}
                onPointerEnter={() => setHovered(n.id)}
                onPointerLeave={() => setHovered(null)}
                style={{ cursor: "grab" }}
              >
                <circle
                  r={r}
                  fill={color(n.type)}
                  fillOpacity={isHl ? 1 : 0.75}
                  stroke={isHl ? "#fff" : "none"}
                  strokeWidth={2}
                />
                {(r > 10 || isHl) && (
                  <text
                    y={r + 12}
                    textAnchor="middle"
                    className="select-none fill-zinc-700 dark:fill-zinc-300"
                    style={{ fontSize: n.type === "platform" ? 11 : 9 }}
                  >
                    {n.label.length > 24 ? n.label.slice(0, 22) + "…" : n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute bottom-2 left-2 max-w-xs rounded-lg bg-zinc-900/90 px-3 py-2 text-xs text-white shadow dark:bg-zinc-100/90 dark:text-zinc-900">
          {idxMap.get(hovered)?.label}
          <span className="ml-2 opacity-60">({idxMap.get(hovered)?.type})</span>
        </div>
      )}
      <div className="absolute right-2 top-2 flex gap-1">
        {Object.entries(TYPE_COLORS).map(([t, c]) => (
          <span key={t} className="flex items-center gap-1 rounded bg-zinc-100/80 px-1.5 py-0.5 text-[10px] dark:bg-zinc-800/80">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
