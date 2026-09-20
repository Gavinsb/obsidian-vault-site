import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { VaultOverview } from "../api";
import { useAuth } from "../auth";

export function SyncBar({ overview }: { overview: VaultOverview | null }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { user } = useAuth();
  const state = overview?.syncState ?? "synced";
  const labels: Record<string, string> = {
    synced: `Vault synced · ${overview?.docCount ?? 0} notes`,
    indexing: `Indexing…`,
    detected: "External change detected…",
    conflict: "Conflict detected",
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <div className={`sync-bar sync-${state}`}>
      <span className="sync-dot" />
      <span className="sync-label">{labels[state] ?? state}</span>
      {overview?.pendingFiles ? (
        <span className="sync-pending">({overview.pendingFiles})</span>
      ) : null}
      <form className="header-search" onSubmit={submit} role="search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search vault…"
          aria-label="Search vault"
        />
      </form>
      {user && (
        <button
          className="header-user"
          aria-label={`Signed in as ${user.username}`}
          title={`Signed in as ${user.username} (${user.role})`}
          onClick={() => navigate("/settings")}
        >
          <span className="header-user-name">{user.username}</span>
          <span className="header-user-role">{user.role}</span>
        </button>
      )}
    </div>
  );
}
