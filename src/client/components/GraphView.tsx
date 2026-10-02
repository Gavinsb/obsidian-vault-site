import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, RotateCcw, Play, Pause } from 'lucide-react';
import { api, type GraphData } from '../api';

const W = 900;
const H = 600;

type Node = GraphData['nodes'][number];

/** Node radius scales with connectivity. */
function radius(linkCount: number): number {
  return Math.max(4, Math.min(6 + Math.sqrt(Math.max(0, linkCount)) * 3, 20));
}

/** Rated notes render green, unrated render blue (via theme tokens). */
function nodeColor(n: Node): string {
  return n.rating !== undefined ? 'var(--ok)' : 'var(--accent)';
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Knowledge graph. SVG + a transform group for zoom/pan.
 *
 * The visible layout is a true damped force simulation (no d3): nodes repel,
 * every edge acts as a spring, and a soft centre force keeps the cloud in
 * frame. Positions are written imperatively each frame — never through React —
 * so the loop stays smooth with hundreds of nodes. The simulation runs until
 * it settles, pauses while panning/pinching, and re-energises on demand.
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
  // Reduced motion: still run the simulation (it is informative, not decorative)
  // but settle immediately instead of animating the convergence.
  const [reducedMotion] = useState<boolean>(() =>
    typeof window === 'undefined' || !window.matchMedia
      ? false
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [simRunning, setSimRunning] = useState(true);
  const navigate = useNavigate();

  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  // Imperative position plumbing.
  const baseRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodeEls = useRef<Map<string, SVGGElement>>(new Map());
  const edgeEls = useRef<Map<number, SVGLineElement>>(new Map());
  const interactingRef = useRef(false);
  const settledRef = useRef(false);
  const simRef = useRef<{
    ids: string[];
    edges: { s: number; t: number }[];
    pos: Float64Array;
    vel: Float64Array;
    radius: Float64Array;
    alpha: number;
  }>({ ids: [], edges: [], pos: new Float64Array(0), vel: new Float64Array(0), radius: new Float64Array(0), alpha: 0 });

  const setZoom = (z: number) => {
    zoomRef.current = z;
    setZoomState(z);
  };
  const setPan = (p: { x: number; y: number }) => {
    panRef.current = p;
    setPanState(p);
  };

  // Force layout (Fruchterman–Reingold) + fit-to-view so all nodes spread
  // Seed the simulation from the circles-around-a-ring initial guess, then let
  // the force loop converge it. Deterministic (index-based) so a given vault
  // always lays out the same way.
  const seedSim = () => {
    const { nodes, edges } = data;
    const ids = nodes.map((n) => n.id);
    const index = new Map(ids.map((id, i) => [id, i]));
    const pos = new Float64Array(ids.length * 2);
    const vel = new Float64Array(ids.length * 2);
    const rad = new Float64Array(ids.length);
    nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const r = 60 + (i % 7) * 22;
      pos[i * 2] = W / 2 + Math.cos(angle) * r;
      pos[i * 2 + 1] = H / 2 + Math.sin(angle) * r;
      rad[i] = radius(n.linkCount);
    });
    const simEdges = edges
      .map((e) => ({ s: index.get(e.source) ?? -1, t: index.get(e.target) ?? -1 }))
      .filter((e) => e.s >= 0 && e.t >= 0);
    simRef.current = {
      ids,
      edges: simEdges,
      pos,
      vel,
      radius: rad,
      alpha: reducedMotion ? 0 : 1,
    };
    baseRef.current = new Map(
      ids.map((id, i) => [id, { x: pos[i * 2], y: pos[i * 2 + 1] }]),
    );
    settledRef.current = reducedMotion;
  };

  // Re-energise the simulation (used by the Re-run button and on data change).
  const reheat = (alpha = 0.9) => {
    simRef.current.alpha = Math.max(simRef.current.alpha, alpha);
    settledRef.current = false;
    setSimRunning(true);
    if (reducedMotion) {
      // Run to completion synchronously for reduced-motion users.
      for (let i = 0; i < 320; i++) simStep(0.022);
      simRef.current.alpha = 0;
      settledRef.current = true;
      setSimRunning(false);
      paint();
    }
  };

  /**
   * One physics tick: pairwise repulsion, spring attraction along edges,
   * soft centre gravity, velocity integration with cooling (alpha) and
   * damping, and a hard clamp that keeps nodes inside the viewBox.
   */
  function simStep(dt: number) {
    const s = simRef.current;
    const n = s.ids.length;
    if (!n) return;
    const { pos, vel, radius: rad, edges } = s;
    const alpha = s.alpha;
    const k = 150;          // ideal edge length
    const repulsion = 5200; // node repulsion strength
    const damping = 0.82;   // velocity retained per tick

    // Repulsion between every pair (intended for a single-user vault's size).
    for (let i = 0; i < n; i++) {
      const ix = i * 2;
      for (let j = i + 1; j < n; j++) {
        const jx = j * 2;
        let dx = pos[ix] - pos[jx];
        let dy = pos[ix + 1] - pos[jx + 1];
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          // Deterministic nudge so exactly-overlapping nodes separate.
          dx = ((i % 7) - 3) * 0.5;
          dy = ((j % 7) - 3) * 0.5;
          d2 = dx * dx + dy * dy + 0.01;
        }
        const d = Math.sqrt(d2);
        const minD = rad[i] + rad[j] + 8;
        const f = (repulsion * alpha) / Math.max(d2, minD * minD);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        vel[ix] += fx; vel[ix + 1] += fy;
        vel[jx] -= fx; vel[jx + 1] -= fy;
      }
    }

    // Spring attraction along edges.
    for (const e of edges) {
      const ix = e.s * 2;
      const jx = e.t * 2;
      const dx = pos[jx] - pos[ix];
      const dy = pos[jx + 1] - pos[ix + 1];
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = ((d - k) * 0.09 * alpha);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      vel[ix] += fx; vel[ix + 1] += fy;
      vel[jx] -= fx; vel[jx + 1] -= fy;
    }

    // Centre gravity + integrate + clamp.
    const pad = 40;
    for (let i = 0; i < n; i++) {
      const ix = i * 2;
      vel[ix] += (W / 2 - pos[ix]) * 0.012 * alpha;
      vel[ix + 1] += (H / 2 - pos[ix + 1]) * 0.012 * alpha;
      vel[ix] *= damping;
      vel[ix + 1] *= damping;
      pos[ix] += vel[ix] * dt * 60;
      pos[ix + 1] += vel[ix + 1] * dt * 60;
      pos[ix] = clamp(pos[ix], pad, W - pad);
      pos[ix + 1] = clamp(pos[ix + 1], pad, H - pad);
    }

    // Cool. Stop when effectively settled.
    s.alpha *= 0.985;
    let maxV = 0;
    for (let i = 0; i < n; i++) {
      maxV = Math.max(maxV, Math.abs(vel[i * 2]), Math.abs(vel[i * 2 + 1]));
    }
    if (s.alpha < 0.02 || maxV < 0.05) {
      s.alpha = 0;
      settledRef.current = true;
      setSimRunning(false);
    }
  }

  // Mirror simulation positions into the DOM (nodes) and the edge lines.
  function paint() {
    const s = simRef.current;
    if (!s.ids.length) return;
    for (let i = 0; i < s.ids.length; i++) {
      const el = nodeEls.current.get(s.ids[i]);
      if (el) el.setAttribute('transform', `translate(${s.pos[i * 2]},${s.pos[i * 2 + 1]})`);
    }
    for (let i = 0; i < s.edges.length; i++) {
      const el = edgeEls.current.get(i);
      if (!el) continue;
      const { s: a, t: b } = s.edges[i];
      el.setAttribute('x1', String(s.pos[a * 2]));
      el.setAttribute('y1', String(s.pos[a * 2 + 1]));
      el.setAttribute('x2', String(s.pos[b * 2]));
      el.setAttribute('y2', String(s.pos[b * 2 + 1]));
    }
    // Keep the memoised map in sync so focusNode() targets the live position.
    const map = baseRef.current;
    for (let i = 0; i < s.ids.length; i++) {
      const p = map.get(s.ids[i]);
      if (p) { p.x = s.pos[i * 2]; p.y = s.pos[i * 2 + 1]; }
    }
  }

  // (Re)seed whenever the graph data changes.
  useEffect(() => {
    seedSim();
    if (!reducedMotion) reheat(1);
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, reducedMotion]);

  // Simulation loop: runs while alpha > 0 and the user is not interacting.
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const s = simRef.current;
      if (s.alpha > 0 && !interactingRef.current) {
        simStep(0.022);
        paint();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    interactingRef.current = true;
    // Panning/pinching must not fight the simulation: freeze it for the drag.
    if (!settledRef.current) reheat(0.6);
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
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
      interactingRef.current = false;
    }
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
    const p = baseRef.current.get(id);
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
          <button
            onClick={() => reheat(1)}
            aria-label="Re-run layout simulation"
            title="Re-run the force layout (unsettle and re-settle the graph)"
          >
            <Play size={14} strokeWidth={1.75} />
            {simRunning && !settledRef.current ? 'Simulating…' : 'Re-run layout'}
          </button>
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
                const dim = activeId ? !(e.source === activeId || e.target === activeId) : false;
                const active = activeId && (e.source === activeId || e.target === activeId);
                return (
                  <line
                    key={i}
                    ref={(el) => {
                      if (el) edgeEls.current.set(i, el);
                      else edgeEls.current.delete(i);
                    }}
                    className={`edge${active ? ' edge-active' : ''}`}
                    strokeOpacity={dim ? 0.1 : active ? 1 : 0.5}
                  />
                );
              })}
            </g>
            <g>
              {data.nodes.map((n) => {
                const isActive = activeId === n.id;
                const isNeighbour = activeId && activeNeighbours.has(n.id);
                const dim = activeId ? !(isActive || isNeighbour) : false;
                return (
                  <g
                    key={n.id}
                    ref={(el) => {
                      if (el) nodeEls.current.set(n.id, el);
                      else nodeEls.current.delete(n.id);
                    }}
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
                      stroke={isActive ? 'var(--warn)' : 'rgba(0,0,0,0.25)'}
                      strokeWidth={isActive ? 3 : 1.5}
                    />
                    {isActive && <circle r={radius(n.linkCount) + 5} fill="none" stroke="var(--warn)" strokeWidth={1} opacity={0.6} />}
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
        {simRunning ? ' Simulating the layout…' : ' Layout settled — click Re-run layout to shake it apart again.'}
      </p>
    </div>
  );
}
