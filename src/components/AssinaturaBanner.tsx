import { useState } from "react";
import { AlertTriangle, XCircle, Loader2, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAssinatura } from "@/hooks/useAssinatura";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

/**
 * Faixa fixa no topo do conteúdo avisando sobre o período gratuito de 3 dias.
 * - status "trial"    → faixa âmbar com a contagem regressiva
 * - status "expirada" → faixa vermelha "modo somente leitura" + botão Reativar (padrão CUBO)
 * - status "ativa"    → não renderiza nada
 *
 * Fase 1: só informa. A trava de escrita entra na Fase 2 (flag TRIAL_ENFORCEMENT no backend).
 */
export function AssinaturaBanner() {
  const { session } = useAuth();
  const { assinatura, recarregar } = useAssinatura();
  const [enviando, setEnviando] = useState(false);

  if (!assinatura || assinatura.status === "ativa") return null;

  const expirada = assinatura.status === "expirada";
  const dias = assinatura.dias_restantes;

  const solicitarReativacao = async () => {
    if (!session?.access_token) return;
    setEnviando(true);
    try {
      const r = await fetch(`${API_BASE}/api/assinatura/reativar-solicitacao`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => ({}));
      const link: string | null = data?.contato_whatsapp
        ? `https://wa.me/${String(data.contato_whatsapp).replace(/\D/g, "")}`
        : data?.contato_site || null;
      toast.success("Pedido de reativação enviado. Nossa equipe vai entrar em contato.");
      if (link) window.open(link, "_blank", "noopener");
      recarregar();
    } catch {
      toast.error("Não foi possível enviar o pedido agora. Tente novamente em instantes.");
    } finally {
      setEnviando(false);
    }
  };

  const base =
    "flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm font-medium border-b";
  const cor = expirada
    ? "bg-red-600 text-white border-red-700"
    : dias <= 1
      ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900"
      : "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900";

  return (
    <div className={`${base} ${cor}`} role="alert">
      {expirada ? (
        <XCircle className="h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      )}

      <span className="flex-1 min-w-[12rem]">
        {expirada ? (
          <>
            <strong>Assinatura inativa.</strong> O sistema está em modo somente leitura — você
            ainda pode consultar os dados, mas não criar ou editar.
          </>
        ) : dias <= 0 ? (
          <>
            <strong>Último dia do período gratuito.</strong> Quando terminar, o sistema entra em
            modo somente leitura.
          </>
        ) : (
          <>
            <strong>Período gratuito:</strong> {dias} {dias === 1 ? "dia restante" : "dias restantes"}.
            Depois disso o sistema fica em modo somente leitura até a ativação.
          </>
        )}
      </span>

      {assinatura.sou_dono ? (
        <button
          onClick={solicitarReativacao}
          disabled={enviando}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold transition-colors disabled:opacity-60 ${
            expirada
              ? "bg-white text-red-700 hover:bg-red-50"
              : "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
          }`}
        >
          {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
          {expirada ? "Reativar" : "Ativar agora"}
        </button>
      ) : (
        <span className="text-xs opacity-80">Fale com o administrador da conta para ativar.</span>
      )}
    </div>
  );
}
