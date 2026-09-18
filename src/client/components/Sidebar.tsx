import { NavLink } from 'react-router-dom';

export interface NavItem {
  label: string;
  icon: string;
  to: string;
}

const ICONS: Record<string, string> = {
  home: '🏠',
  search: '🔍',
  clock: '🕒',
  history: '🕘',
  star: '★',
  'thumbs-up': '👍',
  tag: '#',
  graph: '✳',
  map: '◇',
  'link-off': '∅',
  folder: '📁',
  activity: '📈',
  shield: '🛡',
  settings: '⚙',
};

export function Sidebar({ items, vaultName }: { items: NavItem[]; vaultName: string }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-vault">
        <div className="vault-dot" />
        <span className="vault-name">{vaultName}</span>
      </div>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{ICONS[item.icon] ?? '•'}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          className="nav-item"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('kv:new-note'));
          }}
        >
          <span className="nav-icon">＋</span>
          <span>New note</span>
        </button>
      </div>
    </aside>
  );
}