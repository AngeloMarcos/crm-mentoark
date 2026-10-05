/**
 * LinhaTempoSaude.tsx — linha do tempo de saúde de cada número (aba WhatsApp → Diagnóstico).
 * Lê `GET /api/whatsapp/saude/:agenteId/eventos` (tabela `whatsapp_eventos_saude`, alimentada
 * pelo webhook de conexão/queda, pelo opt-out e pela troca de fase — ver
 * backend/src/services/saudeNumero.ts). Etapa A, 2026-10-05.
 */
import { useEffect, useState } from "react";
import { getAuthToken } from "@/lib/api-token";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Activity } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";

interface Evento {
  tipo: string;
  status_reason: number | null;
  detalhe: { fase?: string; motivo?: string; [k: string]: unknown };
  criado_em: string;
  instancia: string | null;
}

const ROTULO: Record<string, { texto: string; cor: string }> = {
  conectou: { texto: "Conectou", cor: "bg-emerald-500" },
  desconectou: { texto: "Queda de conexão", cor: "bg-yellow-500" },
  logout: { texto: "Desconectado pelo CRM/usuário", cor: "bg-slate-400" },
  ban_suspeito: { texto: "Queda suspeita de ban — quarentena", cor: "bg-red-500" },
  ban_confirmado: { texto: "Ban confirmado", cor: "bg-red-700" },
  mudanca_fase: { texto: "Mudou de fase", cor: "bg-blue-500" },
  optout_recebido: { texto: "Contato pediu para sair (opt-out)", cor: "bg-orange-500" },
  falha_envio: { texto: "Falha de envio", cor: "bg-orange-400" },
};

const ROTULO_FASE: Record<string, string> = {
  perfil: "Perfil", aquecimento_1: "Aquecimento 1", aquecimento_2: "Aquecimento 2", aquecimento_3: "Aquecimento 3",
  pre_oficial: "Pré-oficial", madura: "Madura", quarentena: "Quarentena", banida: "Banida",
};

export function LinhaTempoSaude() {
  const { user } = useAuth();
  const [agentes, setAgentes] = useState<{ id: string; nome: string; evolution_instancia: string | null }[]>([]);
  const [sel, setSel] = useState("");
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.from("agentes").select("id,nome,evolution_instancia").eq("user_id", user.id).then(({ data }) => {
      const lista = ((data ?? []) as { id: string; nome: string; evolution_instancia: string | null }[]).filter(a => !!a.evolution_instancia);
      setAgentes(lista);
      if (lista.length && !sel) setSel(lista[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!sel) return;
    setCarregando(true);
    const t = getAuthToken();
    fetch(`${API_BASE}/api/whatsapp/saude/${sel}/eventos`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(r => (r.ok ? r.json() : []))
      .then(setEventos)
      .catch(() => setEventos([]))
      .finally(() => setCarregando(false));
  }, [sel]);

  return (
    <Card className="p-4 space-y-3 mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-sm font-bold flex items-center gap-2"><Activity className="h-4 w-4" /> Linha do tempo de saúde do número</p>
        <Select value={sel} onValueChange={setSel}>
          <SelectTrigger className="sm:w-64 h-8 text-xs"><SelectValue placeholder="Instância" /></SelectTrigger>
          <SelectContent>
            {agentes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome} ({a.evolution_instancia})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : eventos.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          Nenhum evento registrado ainda. Conexões, quedas, mudanças de fase e opt-outs aparecem aqui a partir de agora.
        </p>
      ) : (
        <ol className="relative border-l pl-4 space-y-2 max-h-80 overflow-y-auto">
          {eventos.map((e, i) => {
            const r = ROTULO[e.tipo] ?? { texto: e.tipo, cor: "bg-slate-400" };
            return (
              <li key={i} className="relative">
                <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${r.cor}`} />
                <p className="text-xs font-semibold">
                  {r.texto}
                  {e.tipo === "mudanca_fase" && e.detalhe?.fase ? `: ${ROTULO_FASE[e.detalhe.fase] ?? e.detalhe.fase}` : ""}
                  {e.status_reason ? ` (código ${e.status_reason})` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(e.criado_em).toLocaleString("pt-BR")}
                  {e.instancia ? ` · ${e.instancia}` : ""}
                  {e.detalhe?.motivo ? ` · ${e.detalhe.motivo}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
