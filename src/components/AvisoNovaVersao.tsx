/**
 * Aviso de versão nova (2026-10-31). O CRM é um app de página única: uma aba aberta antes do deploy
 * continua rodando o código antigo até ser recarregada (caso real: telas já trocadas aparecendo
 * para o usuário). A cada 5 min e ao voltar para a aba, compara o ETag/Last-Modified do index.html
 * (o servidor nunca o guarda em cache) com o do carregamento; mudou → oferece "Atualizar".
 */
import { useEffect } from "react";
import { toast } from "sonner";

const INTERVALO_MS = 5 * 60_000;

async function assinaturaDoIndex(): Promise<string | null> {
  try {
    const r = await fetch("/index.html", { method: "HEAD", cache: "no-store" });
    if (!r.ok) return null;
    return r.headers.get("etag") || r.headers.get("last-modified");
  } catch {
    return null;
  }
}

// Guardadas no MÓDULO, não no componente: cada página monta o próprio CRMLayout, e reler a
// assinatura a cada navegação faria a "inicial" virar a da versão nova — o aviso nunca apareceria.
// O módulo só é avaliado uma vez por carregamento do app.
const assinaturaInicial: Promise<string | null> = assinaturaDoIndex();
let avisado = false;

export function AvisoNovaVersao() {
  useEffect(() => {
    const conferir = async () => {
      const inicial = await assinaturaInicial;
      if (avisado || !inicial) return;
      const atual = await assinaturaDoIndex();
      if (atual && atual !== inicial && !avisado) {
        avisado = true;
        toast("Nova versão do CRM disponível", {
          description: "Atualize para usar as telas e correções mais recentes.",
          duration: Infinity,
          action: { label: "Atualizar", onClick: () => window.location.reload() },
        });
      }
    };

    const timer = window.setInterval(conferir, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === "visible") conferir(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", aoVoltar); };
  }, []);

  return null;
}
