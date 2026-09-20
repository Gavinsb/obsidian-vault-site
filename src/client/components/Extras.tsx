import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type VaultDocSummary, type AppConfig } from "../api";
import { RatingStars } from "./RatingStars";
import { useTheme } from "../theme";
import { useAuth } from "../auth";

export function HighlyRated() {
  const [docs, setDocs] = useState<VaultDocSummary[]>([]);
  useEffect(() => {
    api
      .docs()
      .then((all) =>
        setDocs(
          all
            .filter((d) => d.rating !== undefined)
            .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)),
        ),
      )
      .catch(() => {});
  }, []);
  return (
    <div className="view">
      <h1>Highly rated</h1>
      <ul className="note-list">
        {docs.map((d) => (
          <li key={d.relPath}>
            <Link to={`/note/${encodeURIComponent(d.relPath)}`}>{d.title}</Link>
            <RatingStars value={d.rating} size={14} />
            <span className="folder-path">{d.folder}</span>
          </li>
        ))}
      </ul>
      {docs.length === 0 && <p className="muted">No rated notes yet.</p>}
    </div>
  );
}

export function FolderView() {
  const [params] = useSearchParams();
  const [folders, setFolders] = useState<{ folder: string; count: number }[]>(
    [],
  );
  const [docs, setDocs] = useState<VaultDocSummary[]>([]);
  const [current, setCurrent] = useState(params.get("folder") ?? "");

  useEffect(() => {
    api
      .folders()
      .then(setFolders)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!current) {
      setDocs([]);
      return;
    }
    api
      .docs()
      .then((all) => setDocs(all.filter((d) => d.folder === current)))
      .catch(() => {});
  }, [current]);

  return (
    <div className="view">
      <h1>Folders</h1>
      <div className="folder-tree">
        {folders.map((f) => (
          <button
            key={f.folder}
            className={`folder-item${current === f.folder ? " on" : ""}`}
            onClick={() => setCurrent(f.folder)}
          >
            📁 {f.folder || "(root)"}{" "}
            <span className="tag-count">{f.count}</span>
          </button>
        ))}
      </div>
      {current && (
        <section className="card">
          <h3>Notes in {current}</h3>
          <ul className="note-list">
            {docs.map((d) => (
              <li key={d.relPath}>
                <Link to={`/note/${encodeURIComponent(d.relPath)}`}>
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function OrphansView() {
  const [docs, setDocs] = useState<VaultDocSummary[]>([]);
  const [issues, setIssues] = useState<{ relPath?: string; kind: string }[]>(
    [],
  );
  useEffect(() => {
    (async () => {
      const [h, all] = await Promise.all([api.health(), api.docs()]);
      const orphans = h.issues
        .filter((i) => i.kind === "orphan")
        .map((i) => i.relPath!);
      setIssues(h.issues.filter((i) => i.kind === "orphan"));
      setDocs(all.filter((d) => orphans.includes(d.relPath)));
    })();
  }, []);
  return (
    <div className="view">
      <h1>Orphans ({docs.length})</h1>
      {docs.length === 0 ? (
        <p className="muted">No orphan notes. Nice.</p>
      ) : (
        <ul className="note-list">
          {docs.map((d) => (
            <li key={d.relPath}>
              <Link to={`/note/${encodeURIComponent(d.relPath)}`}>
                {d.title}
              </Link>
              <span className="folder-path">{d.folder}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted hint">
        Orphans have no incoming links and no resolved outgoing links.
      </p>
      {issues.length > 0 && (
        <div className="muted">{issues.length} orphan(s) found.</div>
      )}
    </div>
  );
}

export function SettingsView({ config }: { config: AppConfig | null }) {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [overview, setOverview] = useState<{
    docCount: number;
    lastIndexedAt: string | null;
  } | null>(null);
  const [stats, setStats] = useState<{
    noteCount: number;
    linkCount: number;
    backlinkCount: number;
    tagCount: number;
  } | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState<string | null>(null);

  useEffect(() => {
    api
      .overview()
      .then((o) =>
        setOverview({ docCount: o.docCount, lastIndexedAt: o.lastIndexedAt }),
      )
      .catch(() => {});
    api
      .stats()
      .then(setStats)
      .catch(() => {});
  }, []);

  const doReindex = async () => {
    setReindexing(true);
    setReindexResult(null);
    try {
      const r = await api.reindex();
      setReindexResult(`Re-indexed ${r.count} documents`);
      api
        .overview()
        .then((o) =>
          setOverview({ docCount: o.docCount, lastIndexedAt: o.lastIndexedAt }),
        )
        .catch(() => {});
      api
        .stats()
        .then(setStats)
        .catch(() => {});
    } catch (e) {
      setReindexResult(`Failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setReindexing(false);
    }
  };

  return (
    <div className="view">
      <h1>Settings</h1>
      <section className="card">
        <h3>Vault</h3>
        <dl className="meta-list">
          <dt>Name</dt>
          <dd>{config?.vaultName}</dd>
          <dt>Rating scale</dt>
          <dd>{config?.ratingScale} stars</dd>
        </dl>
        <p className="muted">
          Change the vault by editing <code>VAULT_PATH</code> or{" "}
          <code>config/default.json</code>, then restart the server. No app
          cache lives in the vault.
        </p>
      </section>
      <section className="card">
        <h3>Index</h3>
        <dl className="meta-list">
          <dt>Status</dt>
          <dd>{overview ? "Indexed" : "…"}</dd>
          <dt>Documents</dt>
          <dd>{overview?.docCount ?? "—"}</dd>
          <dt>Links</dt>
          <dd>{stats?.linkCount ?? "—"}</dd>
          <dt>Backlinks</dt>
          <dd>{stats?.backlinkCount ?? "—"}</dd>
          <dt>Tags</dt>
          <dd>{stats?.tagCount ?? "—"}</dd>
          <dt>Last indexed</dt>
          <dd>
            {overview?.lastIndexedAt
              ? new Date(overview.lastIndexedAt).toLocaleString()
              : "—"}
          </dd>
        </dl>
        {user?.role === "admin" ? (
          <button className="primary" onClick={doReindex} disabled={reindexing}>
            {reindexing ? "Re-indexing…" : "Re-index now"}
          </button>
        ) : (
          <p className="muted">
            Administrator sign-in is required to re-index.
          </p>
        )}
        {reindexResult && (
          <p className="muted reindex-result">{reindexResult}</p>
        )}
      </section>
      <section className="card">
        <h3>Theme</h3>
        <div className="theme-toggle">
          {(["dark", "light", "system"] as const).map((t) => (
            <button
              key={t}
              className={theme === t ? "primary" : ""}
              onClick={() => setTheme(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>About</h3>
        <p className="muted">
          A local-first microsite over your Obsidian vault. The Markdown files
          are the source of truth; indexes and caches are disposable and stored
          outside the vault.
        </p>
      </section>
    </div>
  );
}
