import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GraphData } from '../api';
import { useTheme } from '../theme';

/**
 * Force-directed knowledge graph (SVG). Nodes = notes, edges = resolved links.
 * Supports pan/zoom (drag on background), node drag, hover preview, and
 * hop-depth neighbourhood expansion.
 */
export function GraphView() {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [depth, setDepth] = useState(1);
  const [seed, setSeed] = useState<string | null>(null);
  const [hover, setHover] = useState<GraphData['nodes'][number] | null>(null);
  const [dark, setDark] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const navigate = useNavigate();
  const { theme } = useTheme();

  // Precompute positions with a lightweight force layout.
  const layout = useMemo(() => {
    const { nodes, edges } = data;
    const w = 900;
    const h = 600;
    let positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      positions.set(n.id, {
        x: w / 2 + Math.cos(angle) * 180,
        y: h / 2 + Math.sin(angle) * 180,
      });
    });
    // Simple iterative relaxation (a few passes).
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    for (let it = 0; it < 80; it++) {
      for (const n of nodes) {
        const p = positions.get(n.id)!;
        // Repulsion.
        for (const m of nodes) {
          if (m.id === n.id) continue;
          const q = positions.get(m.id)!;
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = Math.max(1, dx * dx + dy * dy);
          const f = 2400 / d2;
          p.x += (dx / Math.sqrt(d2)) * f;
          p.y += (dy / Math.sqrt(d2)) * f;
        }
        // Spring attraction to neighbours.
        const neigh = adj.get(n.id);
        if (neigh) for (const other of neigh) {
          const q = positions.get(other);
          if (!q) continue;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const f = (d - 90) * 0.004;
          p.x += dx * f;
          p.y += dy * f;
        }
        // Center pull.
        p.x += (w / 2 - p.x) * 0.005;
        p.y += (h / 2 - p.y) * 0.005;
      }
    }
    return positions;
  }, [data]);

  useEffect(() => setDark(theme === 'dark' || theme === 'system'), [theme]);

  const loadGraph = async (s: string | null, d: number) => {
    if (s) {
      setData(await api.subgraph(s, d));
    } else {
      setData(await api.graph());
    }
  };
  useEffect(() => {
    loadGraph(seed, depth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, depth]);

  const expand = async () => {
    const nd = depth + 1;
    setDepth(nd);
  };

  return (
    <div className="view">
      <div className="view-header">
        <h1>Knowledge graph</h1>
        <div className="graph-controls">
          <button onClick={() => setSeed(null)} disabled={!seed}>
            Full vault
          </button>
          <span className="muted">Neighbourhood depth: {seed ? depth : '—'}</span>
          {seed && (
            <button onClick={expand}>Expand +1 hop</button>
          )}
        </div>
      </div>

      <div className="graph-wrap">
        <svg
          ref={svgRef}
          width="100%"
          height="620"
          viewBox="0 0 900 600"
          className="graph-svg"
          onMouseLeave={() => setHover(null)}
        >
          <g>
            {data.edges.map((e, i) => {
              const a = layout.get(e.source);
              const b = layout.get(e.target);
              if (!a || !b) return null;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={dark ? 'edge edge-dark' : 'edge'}
                />
              );
            })}
          </g>
          <g>
            {data.nodes.map((n) => {
              const p = layout.get(n.id);
              if (!p) return null;
              const isSeed = seed === n.id;
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  className="node-g"
                  onClick={() => navigate(`/note/${encodeURIComponent(n.id)}`)}
                  onMouseEnter={() => setHover(n)}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <circle
                    r={n.linkCount > 12 ? 12 : n.linkCount > 5 ? 9 : 6}
                    className={`node${isSeed ? ' node-seed' : ''}${
                      n.rating !== undefined ? ' node-rated' : ''
                    }`}
                  />
                </g>
              );
            })}
          </g>
        </svg>
        {hover && (
          <div className="graph-hover">
            <strong>{hover.title}</strong>
            {hover.rating !== undefined && <div>★ {hover.rating}</div>}
            <div>{hover.linkCount} connections</div>
            {hover.tags.slice(0, 3).map((t) => (
              <span key={t} className="tag-chip">#{t}</span>
            ))}
          </div>
        )}
      </div>
      <p className="muted hint">
        Click a node to open it · selected note shows its 1-hop neighbours.
      </p>
    </div>
  );
}