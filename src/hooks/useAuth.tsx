import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/integrations/database/client";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

export interface AppUser {
  id: string;
  email: string;
  role?: string;
  display_name?: string;
  avatar_url?: string | null;
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
  equipeRole: 'gerente' | 'membro' | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<AppUser | null>(null);
  const [session, setSession]     = useState<AppSession | null>(null);
  const [isAdmin, setIsAdmin]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [modulos, setModulos]     = useState<string[]>([]);
  const [modulosLoading, setModulosLoading] = useState(true);
  const [equipeRole, setEquipeRole] = useState<'gerente' | 'membro' | null>(null);

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

  const carregarEquipeRole = async (token: string, currentUserId?: string) => {
    try {
      const r = await fetch(`${API_BASE}/api/equipes/minha`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        if (data.equipe) {
          // Se for owner_id, é gerente. Senão pega o user_role retornado pela query (que vem de equipe_membros)
          const isOwner = currentUserId && data.equipe.owner_id === currentUserId;
          setEquipeRole(isOwner ? 'gerente' : data.equipe.user_role || 'membro');
        } else {
          setEquipeRole(null);
        }
      }
    } catch {
      setEquipeRole(null);
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
        carregarEquipeRole(s.access_token, s.user.id);
      }
      if (_event === "SIGNED_OUT") {
        setSession(null);
        setUser(null);
        setIsAdmin(false);
        setModulos([]);
        setModulosLoading(false);
        setEquipeRole(null);
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
        carregarEquipeRole(s.access_token, s.user.id);
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
    setEquipeRole(null);
  };

  return (
    <AuthContext.Provider value={{
      user, session, isAdmin, loading, signOut,
      modulos, hasModulo, modulosLoading, equipeRole,
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
      equipeRole: null,
    };
  }
  return ctx;
}
