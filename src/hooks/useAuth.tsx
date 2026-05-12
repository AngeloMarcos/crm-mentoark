import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/integrations/database/client";

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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<AppSession | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const resolveAdmin = (u: AppUser | null) => {
    if (!u) { setIsAdmin(false); return; }
    // Role is embedded in the JWT — no extra network call needed
    const role = u.role ?? u.app_metadata?.role ?? u.user_metadata?.role;
    setIsAdmin(role === 'admin');
  };

  useEffect(() => {
    const { data: { subscription } } = api.auth.onAuthStateChange((_event, sess: any) => {
      const s = sess as AppSession | null;
      setSession(s);
      setUser(s?.user ?? null);
      resolveAdmin(s?.user ?? null);
    });

    api.auth.getSession().then(({ data }: any) => {
      const s = data?.session as AppSession | null;
      setSession(s);
      setUser(s?.user ?? null);
      resolveAdmin(s?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await api.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, loading, signOut }}>
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
    };
  }
  return ctx;
}
