/**
 * Isolamento entre contas (tenants): de quem é uma instância do WhatsApp?
 *
 * As instâncias são criadas pela própria plataforma com o id do DONO no nome: `crm_<12 primeiros hex do id>`
 * (mais `_2`, `_3`… quando a conta tem várias). Esse nome é, portanto, prova de quem é o dono. A tabela de
 * `agentes`, ao contrário, é editável por cada conta e pode apontar para o nome de instância de outra — foi
 * assim que 5.602 mensagens da instância `crm_5319f0ed61b3` caíram na conta errada (jun–set/2026).
 *
 * Regra (invariante): se o nome da instância traz um prefixo de dono, a mensagem SÓ pode ser gravada na conta
 * desse dono, seja o que for que `agentes`/`integracoes_config` digam. Nomes fora do padrão (instâncias
 * antigas, nomes livres) continuam resolvidos pelos caminhos de sempre.
 */
import { Pool } from 'pg';

const RE_INSTANCIA_DA_PLATAFORMA = /^crm_([0-9a-f]{12})(?:_\d+)?$/i;

/** Prefixo de dono contido no nome da instância, ou null se o nome não segue o padrão da plataforma. */
export function prefixoDoDono(instancia: string | null | undefined): string | null {
  const m = RE_INSTANCIA_DA_PLATAFORMA.exec((instancia ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** O id (uuid) pertence ao dono indicado pelo prefixo? Compara pelos 12 primeiros hex, sem hífens. */
export function idCombinaComPrefixo(id: string | null | undefined, prefixo: string): boolean {
  return (id ?? '').replace(/-/g, '').toLowerCase().startsWith(prefixo.toLowerCase());
}

/**
 * Dono (conta raiz) de uma instância pelo prefixo do nome. Só devolve se houver EXATAMENTE um dono possível
 * (prefixo ambíguo ou inexistente = null: nesse caso ninguém é "corrigido", a mensagem segue o caminho normal).
 */
export async function donoPeloPrefixo(pool: Pool, instancia: string): Promise<string | null> {
  const prefixo = prefixoDoDono(instancia);
  if (!prefixo) return null;
  const r = await pool.query(
    `SELECT id FROM users
      WHERE replace(id::text, '-', '') LIKE $1 AND (owner_id IS NULL OR owner_id = id)
      LIMIT 2`,
    [`${prefixo}%`],
  ).catch(() => ({ rows: [] as any[] }));
  return r.rows.length === 1 ? String(r.rows[0].id) : null;
}

export interface ResultadoIsolamento {
  userId: string;
  /** true quando o usuário resolvido por outro caminho NÃO era o dono da instância e foi trocado. */
  corrigido: boolean;
  donoDaInstancia: string | null;
}

/**
 * Aplica o invariante ao `userId` resolvido por agentes/integracoes_config. `donoDaConta` devolve a conta raiz
 * do usuário (membro de equipe → dono), para que um membro continue valendo para a instância do seu dono.
 */
export async function garantirDonoDaInstancia(
  pool: Pool,
  instancia: string,
  userIdResolvido: string,
  donoDaConta: (userId: string) => Promise<string>,
): Promise<ResultadoIsolamento> {
  const dono = await donoPeloPrefixo(pool, instancia);
  if (!dono) return { userId: userIdResolvido, corrigido: false, donoDaInstancia: null };
  const raiz = await donoDaConta(userIdResolvido);
  if (raiz === dono) return { userId: userIdResolvido, corrigido: false, donoDaInstancia: dono };
  return { userId: dono, corrigido: true, donoDaInstancia: dono };
}
