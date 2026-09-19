import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, RotateCcw } from 'lucide-react';
import { api, type GraphData } from '../api';

const W = 900;
const H = 600;

type Node = GraphData['nodes'][number];

/** Node radius scales with connectivity. */
function radius(linkCount: number): number {
  return Math.max(4, Math.min(6 + Math.sqrt(Math.max(0, linkCount)) * 3, 20));
}

/** Rated notes render green, unrated render blue. */
function nodeColor(n: Node): string {
  return n.rating !== undefined ? '#37c877' : '#4f8cff';
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Knowledge graph. SVG + a transform group for zoom/pan. No CSS `filter` on
 * SVG elements (Safari-safe); wheel/pinch zoom via passive:false listeners.
 */
export function GraphView() {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [seed, setSeed] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoomState] = useState(1);
  const [pan, setPanState] = useState({ x: 0, y: 0 });
  const [search, setSearch] = useState('');
  const [focusOpen, setFocusOpen] = useState(false);
  const navigate = useNavigate();

  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  const setZoom = (z: number) => {
    zoomRef.current = z;
    setZoomState(z);
  };
  const setPan = (p: { x: number; y: number }) => {
    panRef.current = p;
    setPanState(p);
  };

  // Force layout (Fruchterman–Reingold) + fit-to-view so all nodes spread
  // visibly and never collapse into one blob.
  const layout = useMemo(() => {
    const { nodes, edges } = data;
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const r = 60 + (i % 7) * 22;
      positions.set(n.id, {
        x: W / 2 + Math.cos(angle) * r,
        y: H / 2 + Math.sin(angle) * r,
      });
    });
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    const k = 170; // ideal edge length
    for (let it = 0; it < 250; it++) {
      const maxDisp = Math.max(1, 30 * (1 - it / 250));
      for (const n of nodes) {
        const p = positions.get(n.id)!;
        let fx = 0;
        let fy = 0;
        for (const m of nodes) {
          if (m.id === n.id) continue;
          const q = positions.get(m.id)!;
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = Math.max(60, dx * dx + dy * dy);
          const d = Math.sqrt(d2);
          const f = (k * k) / d; // repulsion
          fx += (dx / d) * f;
          fy += (dy / d) * f;
        }
        const neigh = adj.get(n.id);
        if (neigh) {
          for (const other of neigh) {
            const q = positions.get(other);
            if (!q) continue;
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const f = (d * d) / k; // attraction
            fx += (dx / d) * f;
            fy += (dy / d) * f;
          }
        }
        // Symmetric center gravity keeps the cloud balanced (no runaway elongation).
        fx += (W / 2 - p.x) * 0.04;
        fy += (H / 2 - p.y) * 0.04;
        const mag = Math.sqrt(fx * fx + fy * fy) || 1;
        const disp = Math.min(mag, maxDisp);
        p.x += (fx / mag) * disp;
        p.y += (fy / mag) * disp;
      }
    }
    // Fit to the viewBox with padding (keeps every node on screen).
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const pad = 70;
    const sx = maxX - minX > 1 ? (W - pad * 2) / (maxX - minX) : 1;
    const sy = maxY - minY > 1 ? (H - pad * 2) / (maxY - minY) : 1;
    const s = Math.min(sx, sy, 1.4);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    for (const p of positions.values()) {
      p.x = W / 2 + (p.x - cx) * s;
      p.y = H / 2 + (p.y - cy) * s;
    }
    return positions;
  }, [data]);

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of data.edges) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    }
    return map;
  }, [data]);

  const loadGraph = async (s: string | null, d: number) => {
    if (s) setData(await api.subgraph(s, d));
    else setData(await api.graph());
  };
  useEffect(() => {
    loadGraph(seed, depth);
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, depth]);

  // Wheel zoom (manual listener, passive:false for Safari/Chrome).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nz = clamp(zoomRef.current * factor, 0.25, 6);
      const ratio = nz / zoomRef.current;
      const p = panRef.current;
      setPan({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio });
      setZoom(nz);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const activeId = selectedId ?? hoverId;
  const activeNeighbours = activeId ? neighbours.get(activeId) ?? new Set() : new Set();

  // Pointer handlers (pan + pinch).
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target instanceof Element && e.target.closest('.node-g')) return;
    (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      dragRef.current = { sx: e.clientX, sy: e.clientY, px: panRef.current.x, py: panRef.current.y, moved: false };
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoomRef.current };
      dragRef.current = null;
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const nz = clamp(pinchRef.current.zoom * (dist / Math.max(1, pinchRef.current.dist)), 0.25, 6);
      const rect = svgRef.current!.getBoundingClientRect();
      const mx = ((a.x + b.x) / 2) - rect.left;
      const my = ((a.y + b.y) / 2) - rect.top;
      const ratio = nz / zoomRef.current;
      const p = panRef.current;
      setPan({ x: mx - (mx - p.x) * ratio, y: my - (my - p.y) * ratio });
      setZoom(nz);
      pinchRef.current = { dist, zoom: nz };
      return;
    }

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.sx;
      const dy = e.clientY - dragRef.current.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
      setPan({ x: dragRef.current.px + dx, y: dragRef.current.py + dy });
    }
  };
  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current = null;
  };

  const onNodeClick = (n: Node) => {
    if (dragRef.current?.moved) return; // it was a pan, not a tap
    navigate(`/note/${encodeURIComponent(n.id)}`);
  };

  const zoomBy = (f: number) => {
    const nz = clamp(zoomRef.current * f, 0.25, 6);
    const ratio = nz / zoomRef.current;
    const p = panRef.current;
    const cx = W / 2;
    const cy = H / 2;
    setPan({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio });
    setZoom(nz);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const focusNode = (id: string) => {
    const p = layout.get(id);
    if (p) {
      setPan({ x: W / 2 - p.x * zoomRef.current, y: H / 2 - p.y * zoomRef.current });
    }
    setSelectedId(id);
    setFocusOpen(false);
    setSearch('');
  };

  const searchMatches = data.nodes
    .filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 12);

  return (
    <div className="view graph-view">
      <div className="view-header">
        <h1>Knowledge graph</h1>
      </div>

      <div className="graph-toolbar">
        <div className="graph-controls">
          <button onClick={() => setSeed(null)} disabled={!seed}>Full vault</button>
          {seed && <button onClick={() => setDepth((d) => d + 1)}>Expand +1 hop</button>}
          <span className="muted">{seed ? `Depth ${depth}` : 'All notes'}</span>
        </div>
        <div className="graph-zoom-controls">
          <button onClick={() => zoomBy(1.2)} aria-label="Zoom in"><Plus size={15} strokeWidth={1.75} /></button>
          <button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out"><Minus size={15} strokeWidth={1.75} /></button>
          <button onClick={resetView} aria-label="Reset view"><RotateCcw size={14} strokeWidth={1.75} /> Reset</button>
        </div>
        <div className="graph-search">
          <input
            placeholder="Jump to a note…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setFocusOpen(true); }}
            onFocus={() => setFocusOpen(true)}
            onBlur={() => setTimeout(() => setFocusOpen(false), 150)}
          />
          {focusOpen && search && (
            <ul className="graph-search-results">
              {searchMatches.map((n) => (
                <li key={n.id}>
                  <button onMouseDown={() => focusNode(n.id)}>{n.title}</button>
                </li>
              ))}
              {searchMatches.length === 0 && <li className="muted">No matches</li>}
            </ul>
          )}
        </div>
      </div>

      <div className="graph-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="graph-svg"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onMouseLeave={() => setHoverId(null)}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            <g>
              {data.edges.map((e, i) => {
                const a = layout.get(e.source);
                const b = layout.get(e.target);
                if (!a || !b) return null;
                const dim = activeId ? !(e.source === activeId || e.target === activeId) : false;
                const active = activeId && (e.source === activeId || e.target === activeId);
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    className={`edge${active ? ' edge-active' : ''}`}
                    strokeOpacity={dim ? 0.1 : active ? 1 : 0.5}
                  />
                );
              })}
            </g>
            <g>
              {data.nodes.map((n) => {
                const p = layout.get(n.id);
                if (!p) return null;
                const isActive = activeId === n.id;
                const isNeighbour = activeId && activeNeighbours.has(n.id);
                const dim = activeId ? !(isActive || isNeighbour) : false;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x},${p.y})`}
                    className="node-g"
                    style={{ opacity: dim ? 0.2 : 1, cursor: 'pointer' }}
                    onClick={() => onNodeClick(n)}
                    onPointerEnter={() => setHoverId(n.id)}
                    onPointerLeave={() => setHoverId(null)}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <circle
                      r={radius(n.linkCount)}
                      fill={nodeColor(n)}
                      stroke={isActive ? '#e0a63a' : 'rgba(0,0,0,0.25)'}
                      strokeWidth={isActive ? 3 : 1.5}
                    />
                    {isActive && <circle r={radius(n.linkCount) + 5} fill="none" stroke="#e0a63a" strokeWidth={1} opacity={0.6} />}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        <div className="graph-legend">
          <div className="legend-item"><span className="legend-dot rated" /> Rated</div>
          <div className="legend-item"><span className="legend-dot unrated" /> Unrated</div>
          <div className="legend-item"><span className="legend-dot bigger" /> More connections</div>
        </div>

        {activeId && (() => {
          const n = data.nodes.find((x) => x.id === activeId);
          if (!n) return null;
          return (
            <div className="graph-hover">
              <strong>{n.title}</strong>
              <div>{n.rating !== undefined ? `★ ${n.rating}` : 'Unrated'}</div>
              <div>{n.linkCount} connections</div>
              <div>{activeNeighbours.size} neighbours</div>
              {n.tags.slice(0, 4).map((t) => (
                <span key={t} className="tag-chip">#{t}</span>
              ))}
            </div>
          );
        })()}
      </div>

      <p className="muted hint">
        Scroll/pinch to zoom · drag to pan · hover a node to highlight its links · click to open.
      </p>
    </div>
  );
}