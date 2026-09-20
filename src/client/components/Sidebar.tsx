import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import {
  Home,
  Search,
  Clock,
  History,
  Star,
  ThumbsUp,
  Tag,
  Network,
  Map,
  Unlink,
  Folder,
  Activity,
  Shield,
  Settings,
  Plus,
  X,
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: string;
  to: string;
}

const ICONS: Record<string, ReactNode> = {
  home: <Home size={16} strokeWidth={1.75} />,
  search: <Search size={16} strokeWidth={1.75} />,
  clock: <Clock size={16} strokeWidth={1.75} />,
  history: <History size={16} strokeWidth={1.75} />,
  star: <Star size={16} strokeWidth={1.75} />,
  "thumbs-up": <ThumbsUp size={16} strokeWidth={1.75} />,
  tag: <Tag size={16} strokeWidth={1.75} />,
  graph: <Network size={16} strokeWidth={1.75} />,
  map: <Map size={16} strokeWidth={1.75} />,
  "link-off": <Unlink size={16} strokeWidth={1.75} />,
  folder: <Folder size={16} strokeWidth={1.75} />,
  activity: <Activity size={16} strokeWidth={1.75} />,
  shield: <Shield size={16} strokeWidth={1.75} />,
  settings: <Settings size={16} strokeWidth={1.75} />,
};

export function Sidebar({
  items,
  siteName,
  open,
  onClose,
  canCreate,
}: {
  items: NavItem[];
  siteName: string;
  open: boolean;
  onClose: () => void;
  canCreate: boolean;
}) {
  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-vault">
        <div className="vault-dot" />
        <span className="vault-name">{siteName}</span>
        <button
          className="sidebar-close"
          aria-label="Close menu"
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            onClick={onClose}
          >
            <span className="nav-icon">{ICONS[item.icon] ?? "•"}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      {canCreate && (
        <div className="sidebar-footer">
          <button
            className="nav-item"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("kv:new-note"));
              onClose();
            }}
          >
            <span className="nav-icon">
              <Plus size={16} strokeWidth={1.75} />
            </span>
            <span>New note</span>
          </button>
        </div>
      )}
    </aside>
  );
}
