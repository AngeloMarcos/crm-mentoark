import { useCallback, useEffect, useRef, useState } from "react";
import { lerConversa, type ConversaAtendimento } from "@/lib/atendimento";

const INTERVALO_MS = 20_000;

/** Atendimento da conversa aberta. `gatilho` recarrega quando chega mensagem nova. */
export function useAtendimentoConversa(instancia?: string, jid?: string, gatilho?: number) {
  const [dados, setDados] = useState<ConversaAtendimento | null>(null);
  const ultimaBusca = useRef(0);

  const recarregar = useCallback(async () => {
    if (!instancia || !jid) { setDados(null); return; }
    const busca = ++ultimaBusca.current;
    try {
      const d = await lerConversa(instancia, jid);
      if (busca === ultimaBusca.current) setDados(d); // resposta de conversa antiga não sobrescreve a atual
    } catch { /* mantém o último estado; a próxima volta tenta de novo */ }
  }, [instancia, jid]);

  useEffect(() => {
    setDados(null);
    recarregar();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") recarregar(); }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [recarregar]);

  useEffect(() => {
    if (gatilho !== undefined) recarregar();
  }, [gatilho, recarregar]);

  return { dados, recarregar };
}
