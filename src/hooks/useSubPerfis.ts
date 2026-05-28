import { useState, useEffect } from "react";
import { api } from "@/integrations/database/client";
import { toast } from "sonner";

export interface SubPerfil {
  id: string;
  user_id: string;
  membro_id: string;
  membro_email?: string;
  nome: string;
  email: string;
  avatar_cor: string;
  modulos: string[];
  ativo: boolean;
  primeiro_acesso: boolean;
  created_at: string;
}

export function useSubPerfis() {
  const [subPerfis, setSubPerfis] = useState<SubPerfil[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/sub-perfis");
      setSubPerfis(data || []);
    } catch (err) {
      console.error("Erro ao carregar sub-perfis", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const criarSubPerfil = async (dados: any) => {
    const { data } = await api.post("/api/sub-perfis", dados);
    setSubPerfis((prev) => [data, ...prev]);
    return data;
  };

  const atualizarSubPerfil = async (id: string, dados: any) => {
    const { data } = await api.patch(`/api/sub-perfis/${id}`, dados);
    setSubPerfis((prev) => prev.map((sp) => (sp.id === id ? { ...sp, ...data } : sp)));
    return data;
  };

  const atualizarModulos = async (id: string, modulos: string[]) => {
    const { data } = await api.patch(`/api/sub-perfis/${id}/modulos`, { modulos });
    setSubPerfis((prev) => prev.map((sp) => (sp.id === id ? { ...sp, ...data } : sp)));
    return data;
  };

  const excluirSubPerfil = async (id: string) => {
    await api.delete(`/api/sub-perfis/${id}`);
    setSubPerfis((prev) => prev.map((sp) => (sp.id === id ? { ...sp, ativo: false } : sp)));
  };

  return {
    subPerfis,
    loading,
    carregar,
    criarSubPerfil,
    atualizarSubPerfil,
    atualizarModulos,
    excluirSubPerfil,
  };
}
