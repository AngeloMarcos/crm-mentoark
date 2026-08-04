import { useEffect, useState } from "react";
import { api } from "@/integrations/database/client";

// [AUDITORIA] LÓGICA (Sprint Colunas de Status de Envio, 2026-07-31): hook compartilhado entre
// StepContacts (Disparos.tsx), WhatsAppInterface.tsx e ContatoDetalhe.tsx — evita duplicar a
// query/lógica de "última campanha enviada pra este contato" em 3 arquivos diferentes. Busca em
// lote (POST /api/contatos/status-envio, backend/src/routes/contatos.ts) mesmo pra 1 contato só,
// pra manter um único contrato de API — telas de contato único mandam um array de 1 telefone.
//
// Chave é TELEFONE (não `contato_id`): das 3 telas, só StepContacts/ContatoDetalhe têm um id de
// contato de cara; WhatsAppInterface só tem o telefone da conversa ativa, e ContatoDetalhe busca
// de `dados_cliente` (id BIGINT, espaço de identidade diferente de `contatos.id` UUID) — telefone
// é a única chave universal. O mapa retornado é indexado pelos ÚLTIMOS 11 caracteres do telefone
// (mesmo corte usado pelo backend, `RIGHT(telefone,11)`) — use `chaveTelefone()` abaixo pra
// consultar o mapa com o telefone de um contato específico, garantindo o mesmo corte dos 2 lados.
export interface StatusEnvioInfo {
  ultimo_disparo_em: string;
  campanha_nome: string | null;
}

export function chaveTelefone(telefone: string | null | undefined): string {
  return (telefone || "").slice(-11);
}

export function useStatusEnvio(telefones: string[]): Record<string, StatusEnvioInfo> {
  const [mapa, setMapa] = useState<Record<string, StatusEnvioInfo>>({});
  // Chave estável (ordenada, deduplicada) — evita refetch quando o array de telefones muda de
  // referência mas não de conteúdo (ex: novo array criado a cada render do componente pai).
  const chave = Array.from(new Set(telefones.filter(Boolean))).sort().join(",");

  useEffect(() => {
    const lista = chave ? chave.split(",") : [];
    if (!lista.length) { setMapa({}); return; }
    let cancelado = false;
    (async () => {
      try {
        const { data } = await api.post("/api/contatos/status-envio", { telefones: lista });
        if (!cancelado) setMapa(data || {});
      } catch {
        if (!cancelado) setMapa({});
      }
    })();
    return () => { cancelado = true; };
  }, [chave]);

  return mapa;
}
