/**
 * AlertaWebhookParado.tsx — aviso na aba Instâncias quando o webhook da Evolution de alguma
 * instância parou: ela enviou mensagem há 5+ min e nenhum evento chegou depois (entregues/lidos
 * da campanha ficam parados). Sprint 7 (Sprint 5 / H6), GET /api/whatsapp/saude-webhook.
 */
import { useEffect, useState } from "react";
import { authHeader } from "@/lib/api-token";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export function AlertaWebhookParado() {
  const [parados, setParados] = useState<{ instancia: string; minutos_parado: number; envios_sem_evento: number }[]>([]);
  useEffect(() => {
    const buscar = () => fetch(`${API_URL}/api/whatsapp/saude-webhook`, { headers: authHeader() })
      .then(r => (r.ok ? r.json() : null)).then(d => setParados(d?.parados ?? [])).catch(() => {});
    buscar();
    const t = setInterval(buscar, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!parados.length) return null;
  return (
    <Alert className="mb-3 border-amber-500/50 bg-amber-500/10">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-700 dark:text-amber-400">Confirmações de entrega paradas</AlertTitle>
      <AlertDescription className="text-xs">
        {parados.map(p => `${p.instancia}: ${p.envios_sem_evento} envio(s) sem nenhum retorno da Evolution há ${p.minutos_parado} min`).join(" · ")}.
        As mensagens podem ter saído, mas entregues/lidos não estão chegando ao CRM. Se continuar, reconecte o webhook da instância.
      </AlertDescription>
    </Alert>
  );
}
