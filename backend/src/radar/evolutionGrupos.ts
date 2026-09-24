/**
 * Leitura de convite de grupo pela Evolution API (v2.3.7, instância Baileys):
 *   GET /group/inviteInfo/{instância}?inviteCode=<código>
 * Devolve os metadados SEM entrar no grupo. Só leitura: pode repetir em falha de rede/5xx.
 * Nenhuma outra chamada de grupo (entrar, sair, participantes) existe neste arquivo, de propósito.
 */
export interface InfoConvite {
  jid: string | null;
  nome: string | null;
  descricao: string | null;
  participantes: number | null;
  criadoEm: Date | null;
  somenteAdmins: boolean | null;
  aprovacaoAdmin: boolean | null;
}

export type ResultadoConvite =
  | { tipo: 'ok'; info: InfoConvite }
  | { tipo: 'invalido'; motivo: string }        // link revogado/expirado/inexistente
  | { tipo: 'indisponivel'; motivo: string };   // instância fora do ar, limite, rede — NÃO marca o grupo como inválido

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Normaliza o GroupMetadata do Baileys (campos variam entre versões). */
export function normalizarInviteInfo(j: any): InfoConvite | null {
  if (!j || typeof j !== 'object') return null;
  const nome = typeof j.subject === 'string' && j.subject.trim() ? j.subject.trim() : null;
  const jid = typeof j.id === 'string' ? j.id : null;
  if (!nome && !jid) return null;
  const size = num(j.size) ?? (Array.isArray(j.participants) ? j.participants.length : null);
  const criacao = num(j.creation);
  return {
    jid,
    nome,
    descricao: typeof j.desc === 'string' && j.desc.trim() ? j.desc.trim() : null,
    participantes: size,
    criadoEm: criacao ? new Date(criacao * 1000) : null,
    somenteAdmins: typeof j.announce === 'boolean' ? j.announce : null,
    aprovacaoAdmin: typeof j.joinApprovalMode === 'boolean' ? j.joinApprovalMode : null,
  };
}

const RE_INVALIDO = /\b(gone|revoked|expired|not[- ]?found|item-not-found|invalid|bad-request|forbidden|not-authorized)\b|link.*(inv[aá]lid|expir|revog)/i;
const RE_INSTANCIA = /(not connected|connection closed|instance.*(not|does not)|disconnected|logged out|Connection Closed|Precondition)/i;

/** Classifica uma resposta HTTP de erro da Evolution. Na dúvida NÃO marca como inválido. */
export function classificarErroConvite(status: number, corpo: string): ResultadoConvite {
  if (status === 401 || status === 403) return { tipo: 'indisponivel', motivo: 'Evolution recusou a chave (401/403)' };
  if (status === 429) return { tipo: 'indisponivel', motivo: 'Evolution limitou as requisições (429)' };
  if (status >= 500) return { tipo: 'indisponivel', motivo: `Evolution indisponível (HTTP ${status})` };
  if (RE_INSTANCIA.test(corpo)) return { tipo: 'indisponivel', motivo: 'Instância desconectada ou indisponível' };
  if (status === 404 || status === 410 || (status === 400 && RE_INVALIDO.test(corpo))) {
    return { tipo: 'invalido', motivo: (corpo || `HTTP ${status}`).slice(0, 200) };
  }
  return { tipo: 'indisponivel', motivo: `Resposta inesperada da Evolution (HTTP ${status}): ${corpo.slice(0, 120)}` };
}

export interface ClienteEvolution { base: string; apiKey: string; fetchImpl?: typeof fetch }

const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function consultarConvite(
  c: ClienteEvolution, instancia: string, codigo: string, backoffMs = 1500,
): Promise<ResultadoConvite> {
  const f = c.fetchImpl ?? fetch;
  const url = `${c.base.replace(/\/+$/, '')}/group/inviteInfo/${encodeURIComponent(instancia)}?inviteCode=${encodeURIComponent(codigo)}`;
  let ultimo = 'sem resposta';
  for (let t = 0; t < 2; t++) {           // GET idempotente: 1 retry só em rede/5xx
    try {
      const res = await f(url, { headers: { apikey: c.apiKey }, signal: AbortSignal.timeout(20000) });
      const texto = await res.text();
      if (res.ok) {
        let corpo: any = null;
        try { corpo = JSON.parse(texto); } catch { /* corpo inválido */ }
        const info = normalizarInviteInfo(corpo);
        return info ? { tipo: 'ok', info } : { tipo: 'indisponivel', motivo: 'Resposta da Evolution sem dados do grupo' };
      }
      const r = classificarErroConvite(res.status, texto);
      if (r.tipo === 'indisponivel' && res.status >= 500 && t === 0) { ultimo = r.motivo; await espera(backoffMs); continue; }
      return r;
    } catch (err: any) {
      ultimo = `Falha de rede: ${err?.message ?? 'desconhecida'}`;
      if (t === 0) await espera(backoffMs);
    }
  }
  return { tipo: 'indisponivel', motivo: ultimo };
}

/** A instância precisa estar 'open' antes de qualquer leitura; senão nada é marcado como inválido. */
export async function instanciaConectada(c: ClienteEvolution, instancia: string): Promise<boolean> {
  const f = c.fetchImpl ?? fetch;
  try {
    const res = await f(`${c.base.replace(/\/+$/, '')}/instance/connectionState/${encodeURIComponent(instancia)}`, {
      headers: { apikey: c.apiKey }, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return false;
    const j: any = await res.json();
    return (j?.instance?.state ?? j?.state) === 'open';
  } catch { return false; }
}
