import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/integrations/database/client";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

export interface AppUser {
  id: string;
  email: string;
  role?: string;
  display_name?: string;
  user_metadata?: { display_name?: string; [key: string]: any };
  app_metadata?: { role?: string; [key: string]: any };
  aud?: string;
}

export interface AppSession {
  access_token: string;
  refresh_token?: string;
  user: AppUser;
}

interface AuthContextValue {
  user: AppUser | null;
  session: AppSession | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  modulos: string[];
  hasModulo: (key: string) => boolean;
  modulosLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<AppUser | null>(null);
  const [session, setSession]     = useState<AppSession | null>(null);
  const [isAdmin, setIsAdmin]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [modulos, setModulos]     = useState<string[]>([]);
  const [modulosLoading, setModulosLoading] = useState(true);

  const resolveAdmin = (u: AppUser | null) => {
    if (!u) { setIsAdmin(false); return; }
    const role = u.role ?? u.app_metadata?.role ?? u.user_metadata?.role;
    setIsAdmin(role === "admin");
  };

  const carregarModulos = async (token: string) => {
    try {
      const r = await fetch(`${API_BASE}/api/modulos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        setModulos(Array.isArray(data) ? data : []);
      }
    } catch {
      // fallback silencioso
    } finally {
      setModulosLoading(false);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = api.auth.onAuthStateChange((_event, sess: any) => {
      const s = sess as AppSession | null;
      setSession(s);
      setUser(s?.user ?? null);
      resolveAdmin(s?.user ?? null);

      if (_event === "SIGNED_IN" && s?.access_token) {
        carregarModulos(s.access_token);
      }
      if (_event === "SIGNED_OUT") {
        setModulos([]);
        setModulosLoading(false);
      }
    });

    api.auth.getSession().then(({ data }: any) => {
      const s = data?.session as AppSession | null;
      setSession(s);
      setUser(s?.user ?? null);
      resolveAdmin(s?.user ?? null);
      setLoading(false);

      if (s?.access_token) {
        carregarModulos(s.access_token);
      } else {
        setModulosLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const hasModulo = (key: string): boolean => {
    if (isAdmin) return true;
    return modulos.includes(key);
  };

  const signOut = async () => {
    await api.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
    setModulos([]);
    setModulosLoading(false);
  };

  return (
    <AuthContext.Provider value={{
      user, session, isAdmin, loading, signOut,
      modulos, hasModulo, modulosLoading,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      session: null,
      isAdmin: false,
      loading: true,
      signOut: async () => {},
      modulos: [],
      hasModulo: () => false,
      modulosLoading: true,
    };
  }
  return ctx;
}
