import { useEffect, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { api, type AppConfig, type VaultOverview } from './api';
import { Sidebar, type NavItem } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { DocView } from './components/DocView';
import { Search } from './components/Search';
import { GraphView } from './components/GraphView';
import { TagsView } from './components/TagsView';
import { HealthView } from './components/HealthView';
import { ChangedView } from './components/ChangedView';
import { TimelineView } from './components/TimelineView';
import { RecentView } from './components/RecentView';
import { FavoritesView } from './components/FavoritesView';
import { CommandPalette } from './components/CommandPalette';
import { SyncBar } from './components/SyncBar';
import { ThemeContext, useEffectiveTheme } from './theme';
import { KnowledgeMapView } from './components/KnowledgeMapView';

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('system');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const siteName = config?.siteName ?? 'Doug KX';
  const effectiveTheme = useEffectiveTheme(theme);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.config();
        setConfig(cfg);
        setTheme((cfg.theme as 'dark' | 'light' | 'system') || 'system');
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  // Poll overview for sync status (external changes reflected live).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const o = await api.overview();
        if (alive) setOverview(o);
      } catch {
        /* ignore */
      }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.style.colorScheme = effectiveTheme;
  }, [effectiveTheme]);

  // Close the mobile sidebar on navigation.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const themeValue = useMemo(() => ({ theme, setTheme }), [theme]);

  // Global command palette shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navItems: NavItem[] = useMemo(
    () => [
      { label: 'Home', icon: 'home', to: '/' },
      { label: 'Search', icon: 'search', to: '/search' },
      { label: 'Recent', icon: 'clock', to: '/recent' },
      { label: 'Changed', icon: 'history', to: '/changed' },
      { label: 'Favorites', icon: 'star', to: '/favorites' },
      { label: 'Highly Rated', icon: 'thumbs-up', to: '/rated' },
      { label: 'Tags', icon: 'tag', to: '/tags' },
      { label: 'Graph', icon: 'graph', to: '/graph' },
      { label: 'Knowledge Map', icon: 'map', to: '/knowledge-map' },
      { label: 'Orphans', icon: 'link-off', to: '/orphans' },
      { label: 'Folders', icon: 'folder', to: '/folders' },
      { label: 'Activity', icon: 'activity', to: '/timeline' },
      { label: 'Health', icon: 'shield', to: '/health' },
      { label: 'Settings', icon: 'settings', to: '/settings' },
    ],
    []
  );

  if (error && !config) {
    return (
      <div className="boot-error">
        <h2>Cannot start</h2>
        <p>{error}</p>
        <p>
          Check <code>VAULT_PATH</code> / <code>config/default.json</code> and restart the server.
        </p>
      </div>
    );
  }

  return (
    <ThemeContext.Provider value={themeValue}>
      <div className="app-shell">
        <Sidebar
          items={navItems}
          siteName={siteName}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}
        <main className="app-main">
          <div className="mobile-topbar">
            <button className="menu-btn" aria-label="Menu" onClick={() => setSidebarOpen(true)}>
              ☰
            </button>
            <span className="mobile-title">{siteName}</span>
          </div>
          <SyncBar overview={overview} />
          <div className="app-content">
            <Routes>
              <Route path="/" element={<Dashboard siteName={siteName} />} />
              <Route path="/search" element={<Search />} />
              <Route path="/recent" element={<RecentView />} />
              <Route path="/changed" element={<ChangedView />} />
              <Route path="/favorites" element={<FavoritesView />} />
              <Route path="/rated" element={<HighlyRated />} />
              <Route path="/tags" element={<TagsView />} />
              <Route path="/folders" element={<FolderView />} />
              <Route path="/orphans" element={<OrphansView />} />
              <Route path="/graph" element={<GraphView />} />
              <Route path="/knowledge-map" element={<KnowledgeMapView />} />
              <Route path="/timeline" element={<TimelineView />} />
              <Route path="/health" element={<HealthView />} />
              <Route path="/settings" element={<SettingsView config={config} />} />
              <Route path="/note" element={<Navigate to="/" replace />} />
              <Route path="/note/:path*" element={<DocView key={location.pathname} />} />
            </Routes>
          </div>
        </main>
        {paletteOpen && (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onOpen={(p) => navigate(`/note/${encodeURIComponent(p)}`)}
          />
        )}
      </div>
    </ThemeContext.Provider>
  );
}

import { HighlyRated, FolderView, OrphansView, SettingsView } from './components/Extras';