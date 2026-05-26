import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const API_URL = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

interface ContatoPausa {
  id: number;
  nomewpp: string | null;
  telefone: string;
  atendimento_ia: string;
  pausa_timestamp: string | null;
  pausa_duracao_min: number | null;
}

export function usePausaNotificacoes() {
  const [expirando, setExpirando] = useState<ContatoPausa[]>([]);
  const { session } = useAuth();
  const navigate = useNavigate();

  const checkPausas = useCallback(async () => {
    if (!session?.access_token || document.visibilityState !== 'visible') return;

    try {
      const response = await fetch(`${API_URL}/api/dados_cliente`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!response.ok) return;

      const contatos: ContatoPausa[] = await response.json();
      const agora = Date.now();
      const CINCO_MINUTOS = 5 * 60 * 1000;

      // 1. Filtrar expirando em 5 minutos
      const expirandoEm5 = contatos.filter(c => {
        if (c.atendimento_ia !== 'pause' || !c.pausa_timestamp || !c.pausa_duracao_min || c.pausa_duracao_min === 9999) return false;
        const expira = new Date(c.pausa_timestamp).getTime() + c.pausa_duracao_min * 60000;
        return expira > agora && expira - agora < CINCO_MINUTOS;
      });

      setExpirando(expirandoEm5);

      // 2. Controle de notificações via sessionStorage
      const notificadosStr = sessionStorage.getItem("pausas_notificadas") || "[]";
      let notificadosIds: string[] = JSON.parse(notificadosStr);
      const novosNotificados: string[] = [...notificadosIds];

      expirandoEm5.forEach(contato => {
        const idStr = contato.id.toString();
        if (!notificadosIds.includes(idStr)) {
          toast.info(`⏱️ IA de ${contato.nomewpp || contato.telefone} vai reativar em breve`, {
            description: "Expira em menos de 5 minutos",
            action: { 
              label: "Ver contato", 
              onClick: () => navigate(`/contatos/${contato.id}`) 
            },
            duration: 10000,
          });
          novosNotificados.push(idStr);
        }
      });

      // 3. Limpar IDs que não estão mais na lista de expirando ou que já voltaram ao normal
      const idsAtivos = contatos.map(c => c.id.toString());
      const idsPausados = contatos.filter(c => c.atendimento_ia === 'pause').map(c => c.id.toString());
      
      const notificadosLimpos = novosNotificados.filter(id => idsPausados.includes(id));

      sessionStorage.setItem("pausas_notificadas", JSON.stringify(notificadosLimpos));
    } catch (error) {
      console.error("Erro ao buscar notificações de pausa:", error);
    }
  }, [session, navigate]);

  useEffect(() => {
    checkPausas(); // Primeira execução
    const interval = setInterval(checkPausas, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkPausas();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkPausas]);

  return { expirando };
}
