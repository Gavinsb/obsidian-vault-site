import { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';

export const ThemeContext = createContext<{
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
}>({ theme: 'dark', setTheme: () => {} });

export const useTheme = () => useContext(ThemeContext);

/**
 * Resolve the effective theme. When `theme === 'system'`, follow the OS
 * `prefers-color-scheme` and react to live changes (item #2).
 */
export function useEffectiveTheme(theme: ThemeMode): 'dark' | 'light' {
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && !!window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}