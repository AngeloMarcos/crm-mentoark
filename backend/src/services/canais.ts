/**
 * canais.ts — Canal = número de WhatsApp que aponta para o agente de IA que responde (2026-10-30,
 * modelo Cubo: channel.defaultAgentId). Ver
 * diagnosticos/engenharia_reversa_suite/RELATORIO_INTEGRACOES_E_DESCARTE.md.
 *
 * Número oficial: `whatsapp_oficial_config.agente_id` (já existia).
 * Número QR Code (Evolution): a linha de `agentes` É o número. `agentes.agente_resposta_id` aponta
 * para OUTRO agente cujo "cérebro" (prompt, modelo, comportamento, ferramentas) responde por este
 * número. NULL = a própria linha responde, como antes.
 */

/** Campos que pertencem ao NÚMERO (transporte) e não ao cérebro: ficam da linha da instância. */
export const CAMPOS_DO_NUMERO = [
  'evolution_instancia', 'evolution_server_url', 'evolution_api_key', 'papel', 'numero_conectado',
] as const;

/**
 * Monta o agente que vai responder: cérebro do agente escolhido + transporte do número.
 * `id` fica o do cérebro (execuções e uso de IA contam para quem respondeu).
 */
export function aplicarCerebro<T extends Record<string, any>>(numero: T, cerebro: Record<string, any>): T {
  const resultado: Record<string, any> = { ...cerebro };
  for (const c of CAMPOS_DO_NUMERO) resultado[c] = numero[c];
  resultado.numero_agente_id = numero.id;
  return resultado as T;
}
