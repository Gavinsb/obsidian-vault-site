import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, type SessionUser } from "./api";
interface AuthValue {
  user: SessionUser | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try {
      const s = await api.session();
      setUser(s.authenticated ? s.user! : null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const login = async (u: string, p: string) => {
    const s = await api.login(u, p);
    setUser(s.user);
  };
  const logout = async () => {
    await api.logout();
    setUser(null);
  };
  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const x = useContext(AuthContext);
  if (!x) throw new Error("AuthProvider missing");
  return x;
}
