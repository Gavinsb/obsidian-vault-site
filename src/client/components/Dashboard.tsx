import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type VaultOverview, type ChangeEntry, type VaultDocSummary } from '../api';
import { RatingStars } from './RatingStars';

export function Dashboard({ siteName }: { siteName: string }) {
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [recent, setRecent] = useState<VaultDocSummary[]>([]);
  const [activity, setActivity] = useState<{
    pagesChangedToday: number;
    pagesChangedThisWeek: number;
    lastChanges: ChangeEntry[];
  } | null>(null);
  const [timeline, setTimeline] = useState<{ date: string; title: string; relPath: string }[]>([]);
  const [homeDoc, setHomeDoc] = useState<VaultDocSummary | null>(null);
  const [newNote, setNewNote] = useState(false);
  const [notePath, setNotePath] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [o, r, a, docs] = await Promise.all([
          api.overview(),
          api.recent(8),
          api.activity(),
          api.docs(),
        ]);
        setOverview(o);
        setRecent(r);
        setActivity(a);
        const tl = (await api.timeline()).slice(0, 6);
        setTimeline(tl);
        // Home note = the vault's map-of-content (00 Home folder, or title heuristic).
        const home =
          docs.find((d) => d.folder === '00 Home') ??
          docs.find((d) => /home|index/i.test(d.title)) ??
          null;
        setHomeDoc(home);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    const onNew = () => setNewNote(true);
    window.addEventListener('kv:new-note', onNew);
    return () => window.removeEventListener('kv:new-note', onNew);
  }, []);

  const createNote = async () => {
    if (!notePath.trim()) return;
    const p = notePath.trim().endsWith('.md') ? notePath.trim() : `${notePath.trim()}.md`;
    const content = `---\ntype: note\nstatus: draft\ncreated: ${new Date().toISOString().slice(0, 10)}\nupdated: ${new Date().toISOString().slice(0, 10)}\ntags: []\n---\n\n# ${p.replace(/\.md$/, '').split('/').pop()}\n\n`;
    try {
      await api.createDoc(p, content);
      navigate(`/note/${encodeURIComponent(p)}`);
    } catch (e) {
      setCreateError(`Could not create: ${e instanceof Error ? e.message : e}`);
    }
  };

  const stats = overview?.stats;
  return (
    <div className="view">
      <div className="view-header">
        <h1>{siteName}</h1>
        <p className="muted">
          {overview?.docCount ?? 0} notes · {overview?.folderCount ?? 0} folders
        </p>
      </div>

      <div className="quick-links">
        {homeDoc && (
          <Link className="quick-link primary-link" to={`/note/${encodeURIComponent(homeDoc.relPath)}`}>
            📖 Open Home Note
          </Link>
        )}
        <Link className="quick-link" to="/knowledge-map">
          ◇ Knowledge Map
        </Link>
        <Link className="quick-link" to="/graph">
          ✳ Graph
        </Link>
      </div>

      {newNote && (
        <div className="new-note-bar">
          <input
            placeholder="Folder/Note Name.md  (leave blank to cancel)"
            value={notePath}
            onChange={(e) => setNotePath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createNote()}
            autoFocus
          />
          <button className="primary" onClick={createNote}>
            Create
          </button>
          <button onClick={() => { setNewNote(false); setCreateError(null); }}>Cancel</button>
        </div>
      )}
      {createError && <div className="flash flash-err">{createError}</div>}

      <div className="stat-grid">
        <Stat label="Total notes" value={stats?.noteCount ?? '—'} />
        <Stat label="Links" value={stats?.linkCount ?? '—'} />
        <Stat label="Backlinks" value={stats?.backlinkCount ?? '—'} />
        <Stat label="Tags" value={stats?.tagCount ?? '—'} />
        <Stat label="Orphans" value={stats?.orphanCount ?? '—'} />
        <Stat label="Broken links" value={stats?.brokenLinkCount ?? '—'} />
        <Stat label="Avg rating" value={stats?.avgRating ?? '—'} />
        <Stat label="Unrated" value={stats?.unratedCount ?? '—'} />
      </div>

      <div className="dash-cols">
        <section className="card">
          <h3>Recently modified</h3>
          {recent.length === 0 ? (
            <p className="muted">No documents yet.</p>
          ) : (
            <ul className="note-list note-list-col">
              {recent.map((d) => (
                <li key={d.relPath}>
                  <Link to={`/note/${encodeURIComponent(d.relPath)}`} className="note-title">
                    {d.title}
                  </Link>
                  <div className="note-sub">
                    <span>{timeAgo(d.mtimeMs)}</span>
                    <RatingStars value={d.rating} size={12} />
                    {d.tags.slice(0, 3).map((t) => (
                      <Link key={t} to={`/search?tag=${encodeURIComponent(t)}`} className="tag-chip">#{t}</Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h3>Vault activity</h3>
          <div className="activity-stats">
            <div>{activity?.pagesChangedToday ?? 0} changed today</div>
            <div>{activity?.pagesChangedThisWeek ?? 0} changed this week</div>
          </div>
          <ul className="note-list compact">
            {(activity?.lastChanges ?? []).slice(0, 8).map((c) => (
              <li key={`${c.seq}`}>
                <span className={`change-badge ${c.type}`}>{c.type}</span>
                <Link to={`/note/${encodeURIComponent(c.relPath.split(' -> ').pop() ?? c.relPath)}`}>
                  {c.title ?? c.relPath}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Activity timeline</h3>
          <ul className="timeline-mini">
            {timeline.map((t, i) => (
              <li key={i}>
                <span className="tl-date">{t.date}</span>
                <Link to={`/note/${encodeURIComponent(t.relPath)}`}>{t.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}