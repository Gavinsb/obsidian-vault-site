import type { VaultOverview } from '../api';

export function SyncBar({ overview }: { overview: VaultOverview | null }) {
  const state = overview?.syncState ?? 'synced';
  const labels: Record<string, string> = {
    synced: `Vault synced · ${overview?.docCount ?? 0} notes`,
    indexing: `Indexing…`,
    detected: 'External change detected…',
    conflict: 'Conflict detected',
  };
  return (
    <div className={`sync-bar sync-${state}`}>
      <span className="sync-dot" />
      <span>{labels[state] ?? state}</span>
      {overview?.pendingFiles ? <span className="sync-pending">({overview.pendingFiles})</span> : null}
    </div>
  );
}