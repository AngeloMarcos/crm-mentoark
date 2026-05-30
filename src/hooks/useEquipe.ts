import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

export interface Membro {
  user_id: string;
  email: string;
  display_name: string;
  role: 'membro' | 'gerente';
  created_at: string;
}

export interface Equipe {
  id: string;
  nome: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export function useEquipe() {
  const { session } = useAuth();
  const [equipe, setEquipe] = useState<Equipe | null>(null);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEquipe = useCallback(async () => {
    if (!session?.access_token) return;

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/equipes/minha`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) throw new Error("Falha ao carregar equipe");

      const data = await res.json();
      setEquipe(data.equipe);
      setMembros(data.membros || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchEquipe();
  }, [fetchEquipe]);

  const criarEquipe = async (nome: string) => {
    if (!session?.access_token) return;

    const res = await fetch(`${API_BASE}/api/equipes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ nome }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Erro ao criar equipe");
    }

    const data = await res.json();
    setEquipe(data);
    // Após criar, o criador é o primeiro membro (gerente)
    // Recarregar para garantir dados consistentes
    await fetchEquipe();
    return data;
  };

  const convidarMembro = async (email: string, role: string) => {
    if (!session?.access_token || !equipe) return;

    const res = await fetch(`${API_BASE}/api/equipes/${equipe.id}/convidar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email, role }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Erro ao convidar membro");
    }

    await fetchEquipe();
  };

  const removerMembro = async (userId: string) => {
    if (!session?.access_token || !equipe) return;

    const res = await fetch(`${API_BASE}/api/equipes/${equipe.id}/membros/${userId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Erro ao remover membro");
    }

    await fetchEquipe();
  };

  const adicionarMembro = async (userId: string, role: string) => {
    if (!session?.access_token || !equipe) return;

    const res = await fetch(`${API_BASE}/api/equipes/${equipe.id}/membros`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ user_id: userId, role }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Erro ao adicionar membro");
    }

    await fetchEquipe();
  };

  return {
    equipe,
    membros,
    loading,
    error,
    criarEquipe,
    convidarMembro,
    adicionarMembro,
    removerMembro,
    refresh: fetchEquipe,
  };
}
