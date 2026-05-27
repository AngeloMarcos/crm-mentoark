import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

export interface MensagemChat {
  id: string;
  equipe_id: string;
  user_id: string;
  conteudo: string;
  created_at: string;
  nome: string;
  email: string;
}

export function useEquipeChat(equipeId?: string) {
  const { session, user } = useAuth();
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [loading, setLoading] = useState(true);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchMensagens = useCallback(async (isInitial = false) => {
    if (!session?.access_token || !equipeId) return;

    try {
      if (isInitial) setLoading(true);
      const res = await fetch(`${API_BASE}/api/equipes/${equipeId}/chat`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setMensagens(data);
      }
    } catch (error) {
      console.error("Erro ao buscar mensagens:", error);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [session?.access_token, equipeId]);

  useEffect(() => {
    if (!equipeId) {
      setMensagens([]);
      setLoading(false);
      return;
    }

    fetchMensagens(true);

    pollingRef.current = setInterval(() => {
      fetchMensagens();
    }, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [equipeId, fetchMensagens]);

  const enviarMensagem = async (conteudo: string) => {
    if (!session?.access_token || !equipeId || !user) return;

    // Optimistic UI
    const mensagemOtimista: MensagemChat = {
      id: `temp-${Date.now()}`,
      equipe_id: equipeId,
      user_id: user.id,
      conteudo,
      created_at: new Date().toISOString(),
      nome: user.display_name || user.email,
      email: user.email,
    };

    setMensagens((prev) => [...prev, mensagemOtimista]);

    try {
      const res = await fetch(`${API_BASE}/api/equipes/${equipeId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ conteudo }),
      });

      if (!res.ok) {
        throw new Error("Erro ao enviar mensagem");
      }

      const novaMensagem = await res.json();
      
      // Substitui a mensagem otimista pela real
      setMensagens((prev) => 
        prev.map((m) => (m.id === mensagemOtimista.id ? novaMensagem : m))
      );
    } catch (error) {
      // Remove a mensagem otimista em caso de erro
      setMensagens((prev) => prev.filter((m) => m.id !== mensagemOtimista.id));
      throw error;
    }
  };

  return {
    mensagens,
    loading,
    enviarMensagem,
  };
}
