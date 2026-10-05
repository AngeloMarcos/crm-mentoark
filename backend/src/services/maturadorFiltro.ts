/**
 * maturadorFiltro.ts — reconhece, no webhook, mensagem trocada pelo Maturador de Números
 * (Maturador v2, 2026-10-04).
 *
 * [AUDITORIA] BUG CORRIGIDO: até a v1, a única proteção contra a IA responder uma mensagem do
 * maturador era um guard-rail na ATIVAÇÃO do par (`routes/maturador.ts`), que exigia a conta não
 * ter nenhum agente/prompt que pudesse responder. Isso (1) obrigava o usuário a desligar a IA da
 * conta inteira pra usar o maturador, e (2) não protegia contra mudanças feitas DEPOIS da
 * ativação (ligar um prompt com o par já rodando). Além disso a mensagem virava contato/lead e
 * pausava a IA do "contato" (o outro número do próprio usuário) no lado remetente.
 * [AUDITORIA] FIX APLICADO: o webhook consulta `ehTrafegoMaturador()` logo após resolver o
 * userId e, se for tráfego do maturador, só grava em `whatsapp_messages` (o Score de Saúde usa
 * essa tabela) e encerra — sem contato, sem IA, sem n8n, sem Whisper/Vision. Dois sinais
 * independentes, qualquer um basta:
 *   1. `message_id` registrado pelo motor (o id é o MESMO no remetente e no destinatário) —
 *      funciona até com endereçamento @lid, onde o telefone não vem no remoteJid;
 *   2. telefone do outro lado bate com o número de uma ponta de algum par do MESMO usuário —
 *      cobre a corrida em que o webhook chega antes do motor gravar o id.
 */
import { Pool } from 'pg';

// Ids enviados recentemente pelo motor — caminho rápido, sem ir no banco.
const idsRecentes = new Map<string, number>();
const IDS_TTL_MS = 30 * 60 * 1000;

export function registrarIdMaturador(messageId: string | null): void {
  if (!messageId) return;
  idsRecentes.set(messageId, Date.now());
  if (idsRecentes.size > 5000) {
    const limite = Date.now() - IDS_TTL_MS;
    for (const [id, em] of idsRecentes) if (em < limite) idsRecentes.delete(id);
  }
}

// Números dos pares por usuário — cache curto, a lista muda raramente.
const numerosCache = new Map<string, { numeros: string[]; em: number }>();
const NUMEROS_TTL_MS = 60 * 1000;

async function numerosDosPares(pool: Pool, userId: string): Promise<string[]> {
  const c = numerosCache.get(userId);
  if (c && Date.now() - c.em < NUMEROS_TTL_MS) return c.numeros;
  const r = await pool.query(
    `SELECT mp.numero_a, mp.numero_b, a.numero_conectado AS na, b.numero_conectado AS nb
     FROM maturador_pares mp
     JOIN agentes a ON a.id = mp.agente_a_id
     JOIN agentes b ON b.id = mp.agente_b_id
     WHERE mp.user_id = $1`,
    [userId]
  );
  const numeros = new Set<string>();
  for (const row of r.rows) {
    for (const n of [row.numero_a, row.numero_b, row.na, row.nb]) {
      const d = String(n || '').replace(/\D/g, '');
      if (d.length >= 10) numeros.add(d);
    }
  }
  const lista = [...numeros];
  numerosCache.set(userId, { numeros: lista, em: Date.now() });
  return lista;
}

/** Mesmo número? Tolera o 9º dígito brasileiro presente/ausente (compara DDI+DDD e os 8 finais). */
function mesmoNumero(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 12 && b.length >= 12 && a.slice(0, 4) === b.slice(0, 4) && a.slice(-8) === b.slice(-8);
}

export async function ehTrafegoMaturador(
  pool: Pool,
  userId: string,
  messageId: string,
  telefonesCandidatos: Array<string | null | undefined>
): Promise<boolean> {
  if (messageId && idsRecentes.has(messageId)) return true;

  const numeros = await numerosDosPares(pool, userId).catch(() => [] as string[]);
  if (!numeros.length) return false; // usuário sem par nenhum — caminho comum, custo de 1 query cacheada

  const candidatos = telefonesCandidatos
    .map(t => String(t || '').split('@')[0].replace(/\D/g, ''))
    .filter(t => t.length >= 10);
  if (candidatos.some(c => numeros.some(n => mesmoNumero(c, n)))) return true;

  if (messageId) {
    const r = await pool.query(`SELECT 1 FROM maturador_mensagens WHERE message_id = $1 LIMIT 1`, [messageId]).catch(() => ({ rows: [] as any[] }));
    if (r.rows.length) return true;
  }
  return false;
}

/** Chamado quando os pares mudam (criar/excluir), pra o webhook enxergar na hora. */
export function invalidarNumerosMaturador(userId: string): void {
  numerosCache.delete(userId);
}
