/**
 * atendimentos.ts — Sprint Atendimento v1, Fase 2 (diagnosticos/SPRINT_ATENDIMENTO_V1.md).
 * Ações do atendente sobre uma conversa (atribuir, transferir, resolver, reabrir, pausar a IA,
 * notas internas) e o cadastro de motivos. Tudo escopado pela CONTA (users.owner_id): atendimento,
 * atendente ou motivo de outra conta responde como inexistente.
 */
import { Router, Response } from 'express';
import { Pool, PoolClient } from 'pg';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { resolverOwnerId } from '../services/subscription';
import { withTenantContext } from '../db';
import {
  gravarEvento, pausarIA, devolverIA, iaEstaPausada, erroDeEstado, lerMinutosPausa, lerNota, ehUuid, jidAtendivel,
  type AcaoComEstado,
} from '../services/atendimento';

class Recusa extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type TipoMotivo = 'transferencia' | 'resolucao' | 'pausa' | 'perda';
const TIPOS_MOTIVO: TipoMotivo[] = ['transferencia', 'resolucao', 'pausa', 'perda'];

const MOTIVOS_PADRAO: Partial<Record<TipoMotivo, string[]>> = {
  resolucao: ['Dúvida resolvida', 'Venda feita', 'Sem resposta do cliente'],
  transferencia: ['Fora do horário', 'Assunto de outro setor'],
};

function erroHttp(res: Response, err: any, contexto: string) {
  if (err instanceof Recusa) return res.status(err.status).json({ message: err.message });
  log.error('ATENDIMENTO', contexto, { err: err?.message });
  return res.status(500).json({ message: 'Erro ao processar o atendimento.' });
}

async function atendenteDaConta(db: PoolClient, ownerId: string, atendenteId: unknown): Promise<string> {
  if (!ehUuid(atendenteId)) throw new Recusa(400, 'Escolha um atendente.');
  const r = await db.query(`SELECT id FROM users WHERE id = $1 AND COALESCE(owner_id, id) = $2`, [atendenteId, ownerId]);
  if (!r.rowCount) throw new Recusa(400, 'Atendente não encontrado nesta conta.');
  return atendenteId as string;
}

/** Devolve o id do motivo validado, ou null se nenhum foi informado (e nenhum é exigido). */
async function motivoDaConta(db: PoolClient, ownerId: string, tipo: TipoMotivo, motivoId: unknown, exigivel: boolean): Promise<string | null> {
  if (motivoId === undefined || motivoId === null || motivoId === '') {
    if (exigivel) {
      const c = await db.query(`SELECT motivo_obrigatorio FROM atendimento_config WHERE user_id = $1`, [ownerId]);
      if (c.rows[0]?.motivo_obrigatorio) throw new Recusa(400, 'Escolha um motivo.');
    }
    return null;
  }
  if (!ehUuid(motivoId)) throw new Recusa(400, 'Motivo inválido.');
  const r = await db.query(`SELECT id FROM motivos WHERE id = $1 AND user_id = $2 AND tipo = $3 AND ativo`, [motivoId, ownerId, tipo]);
  if (!r.rowCount) throw new Recusa(400, 'Motivo inválido.');
  return motivoId as string;
}

interface Contexto { db: PoolClient; at: any; ownerId: string; autorId: string; body: any }

export function atendimentosRouter(pool: Pool): Router {
  const router = Router();

  /** Roda a ação numa transação, com o atendimento travado: ou grava tudo, ou nada. */
  const acao = (estadoExigido: AcaoComEstado | null, fn: (c: Contexto) => Promise<void>) =>
    async (req: AuthRequest, res: Response) => {
      if (!ehUuid(req.params.id)) return res.status(404).json({ message: 'Atendimento não encontrado.' });
      const client = await pool.connect();
      try {
        const ownerId = await resolverOwnerId(pool, req.userId!);
        await client.query('BEGIN');
        const at = (await client.query(`SELECT * FROM atendimentos WHERE id = $1 AND user_id = $2 FOR UPDATE`, [req.params.id, ownerId])).rows[0];
        if (!at) throw new Recusa(404, 'Atendimento não encontrado.');
        if (estadoExigido) {
          const erro = erroDeEstado(at.estado, estadoExigido);
          if (erro) throw new Recusa(409, erro);
        }
        await fn({ db: client, at, ownerId, autorId: req.userId!, body: req.body || {} });
        const atual = (await client.query(`SELECT * FROM atendimentos WHERE id = $1`, [at.id])).rows[0];
        await client.query('COMMIT');
        return res.json(atual);
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        if (err?.code === '23505') return res.status(409).json({ message: 'Já existe um atendimento em andamento nesta conversa.' });
        return erroHttp(res, err, 'Falha na ação do atendimento');
      } finally {
        client.release();
      }
    };

  router.get('/conversa', async (req: AuthRequest, res: Response) => {
    try {
      const instancia = typeof req.query.instancia === 'string' ? req.query.instancia : '';
      const jid = typeof req.query.jid === 'string' ? req.query.jid : '';
      if (!instancia || !jid) return res.status(400).json({ message: 'Informe instancia e jid.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const atendimento = (await pool.query(
        `SELECT a.*, u.display_name AS atendente_nome
         FROM atendimentos a LEFT JOIN users u ON u.id = a.atendente_id
         WHERE a.user_id = $1 AND a.instance_name = $2 AND a.remote_jid = $3
         ORDER BY (a.estado <> 'resolvido') DESC, a.created_at DESC LIMIT 1`,
        [ownerId, instancia, jid]
      )).rows[0] || null;
      const eventos = (await pool.query(
        `SELECT e.id, e.atendimento_id, e.tipo, e.origem, e.texto, e.ate, e.created_at, e.autor_id,
                autor.display_name AS autor_nome, de.display_name AS de_nome, para.display_name AS para_nome, m.nome AS motivo_nome
         FROM atendimento_eventos e
         JOIN atendimentos a ON a.id = e.atendimento_id
         LEFT JOIN users autor ON autor.id = e.autor_id
         LEFT JOIN users de ON de.id = e.de_atendente
         LEFT JOIN users para ON para.id = e.para_atendente
         LEFT JOIN motivos m ON m.id = e.motivo_id
         WHERE a.user_id = $1 AND a.instance_name = $2 AND a.remote_jid = $3
         ORDER BY e.created_at DESC, e.id DESC LIMIT 200`,
        [ownerId, instancia, jid]
      )).rows.reverse();
      const telefone = atendimento?.telefone || jid.split('@')[0];
      const p = (await pool.query(
        `SELECT c.atendente_pausou_ia, c.ia_pausada_ate, d.atendimento_ia
         FROM contatos c LEFT JOIN dados_cliente d ON d.user_id = c.user_id AND d.telefone ILIKE '%' || RIGHT(c.telefone, 11)
         WHERE c.user_id = $1 AND c.telefone ILIKE $2 LIMIT 1`,
        [ownerId, `%${telefone.slice(-11)}`]
      )).rows[0];
      return res.json({
        atendimento,
        eventos,
        ia: {
          pausada: iaEstaPausada({ atendentePausouIa: p?.atendente_pausou_ia, atendimentoIa: p?.atendimento_ia, iaPausadaAte: p?.ia_pausada_ate }, new Date()),
          ate: p?.ia_pausada_ate ?? null,
        },
      });
    } catch (err: any) { return erroHttp(res, err, 'Falha ao ler o atendimento'); }
  });

  // Conversa parada não tem atendimento: quem clica em "Iniciar atendimento" assume a conversa.
  router.post('/abrir', async (req: AuthRequest, res: Response) => {
    try {
      const instancia = typeof req.body?.instancia === 'string' ? req.body.instancia : '';
      const jid = typeof req.body?.jid === 'string' ? req.body.jid : '';
      if (!instancia || !jidAtendivel(jid)) return res.status(400).json({ message: 'Conversa inválida.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const existe = await withTenantContext({ userId: ownerId, isAdmin: false }, c => c.query(
        `SELECT 1 FROM whatsapp_messages WHERE user_id = $1 AND instance_name = $2 AND remote_jid = $3 LIMIT 1`, [ownerId, instancia, jid]
      ));
      if (!existe.rowCount) return res.status(404).json({ message: 'Conversa não encontrada.' });
      const telefone = jid.split('@')[0];
      const contato = (await pool.query(`SELECT id FROM contatos WHERE user_id = $1 AND telefone ILIKE $2 LIMIT 1`, [ownerId, `%${telefone.slice(-11)}`])).rows[0];
      const novo = (await pool.query(
        `INSERT INTO atendimentos (user_id, instance_name, remote_jid, telefone, contato_id, estado, origem, atendente_id)
         VALUES ($1, $2, $3, $4, $5, 'aberto', 'atendente', $6)
         ON CONFLICT (user_id, instance_name, remote_jid) WHERE estado <> 'resolvido' DO NOTHING RETURNING *`,
        [ownerId, instancia, jid, telefone, contato?.id ?? null, req.userId]
      )).rows[0];
      if (novo) {
        await gravarEvento(pool, novo.id, ownerId, 'aberto', 'humano', { autorId: req.userId });
        await gravarEvento(pool, novo.id, ownerId, 'atribuido', 'humano', { autorId: req.userId, paraAtendente: req.userId });
        return res.status(201).json(novo);
      }
      const atual = (await pool.query(
        `SELECT * FROM atendimentos WHERE user_id = $1 AND instance_name = $2 AND remote_jid = $3 AND estado <> 'resolvido'`, [ownerId, instancia, jid]
      )).rows[0];
      return res.json(atual);
    } catch (err: any) { return erroHttp(res, err, 'Falha ao iniciar o atendimento'); }
  });

  // Mesma regra da lista de conversas: cada conversa conta uma vez, pelo ciclo atual.
  router.get('/contadores', async (req: AuthRequest, res: Response) => {
    try {
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE estado = 'aberto')::int AS aberto,
                COUNT(*) FILTER (WHERE estado = 'aguardando')::int AS aguardando,
                COUNT(*) FILTER (WHERE estado = 'resolvido')::int AS resolvido,
                COUNT(*) FILTER (WHERE estado <> 'resolvido' AND atendente_id = $2)::int AS meus,
                COUNT(*) FILTER (WHERE estado <> 'resolvido' AND atendente_id IS NULL)::int AS sem_atendente
         FROM (
           SELECT DISTINCT ON (instance_name, remote_jid) estado, atendente_id
           FROM atendimentos WHERE user_id = $1
           ORDER BY instance_name, remote_jid, (estado <> 'resolvido') DESC, created_at DESC
         ) atual`,
        [ownerId, req.userId]
      );
      return res.json(r.rows[0]);
    } catch (err: any) { return erroHttp(res, err, 'Falha ao contar atendimentos'); }
  });

  router.get('/atendentes', async (req: AuthRequest, res: Response) => {
    try {
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `SELECT id, display_name, email FROM users WHERE COALESCE(owner_id, id) = $1 ORDER BY (id = $1) DESC, display_name ASC`,
        [ownerId]
      );
      return res.json(r.rows);
    } catch (err: any) { return erroHttp(res, err, 'Falha ao listar atendentes'); }
  });

  router.get('/config', async (req: AuthRequest, res: Response) => {
    try {
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(`SELECT motivo_obrigatorio FROM atendimento_config WHERE user_id = $1`, [ownerId]);
      return res.json({ motivo_obrigatorio: r.rows[0]?.motivo_obrigatorio === true });
    } catch (err: any) { return erroHttp(res, err, 'Falha ao ler a configuração'); }
  });

  router.put('/config', async (req: AuthRequest, res: Response) => {
    try {
      if (typeof req.body?.motivo_obrigatorio !== 'boolean') return res.status(400).json({ message: 'Informe motivo_obrigatorio (true ou false).' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      await pool.query(
        `INSERT INTO atendimento_config (user_id, motivo_obrigatorio) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET motivo_obrigatorio = EXCLUDED.motivo_obrigatorio, updated_at = NOW()`,
        [ownerId, req.body.motivo_obrigatorio]
      );
      return res.json({ motivo_obrigatorio: req.body.motivo_obrigatorio });
    } catch (err: any) { return erroHttp(res, err, 'Falha ao salvar a configuração'); }
  });

  router.post('/:id/atribuir', acao('atribuir', async ({ db, at, ownerId, autorId, body }) => {
    const para = await atendenteDaConta(db, ownerId, body.atendente_id ?? autorId);
    await db.query(`UPDATE atendimentos SET atendente_id = $2, estado = 'aberto', updated_at = NOW() WHERE id = $1`, [at.id, para]);
    if (para !== at.atendente_id) await gravarEvento(db, at.id, ownerId, 'atribuido', 'humano', { autorId, deAtendente: at.atendente_id, paraAtendente: para });
  }));

  router.post('/:id/transferir', acao('transferir', async ({ db, at, ownerId, autorId, body }) => {
    const para = await atendenteDaConta(db, ownerId, body.atendente_id);
    if (para === at.atendente_id) throw new Recusa(400, 'A conversa já está com este atendente.');
    const motivoId = await motivoDaConta(db, ownerId, 'transferencia', body.motivo_id, true);
    await db.query(`UPDATE atendimentos SET atendente_id = $2, estado = 'aberto', updated_at = NOW() WHERE id = $1`, [at.id, para]);
    await gravarEvento(db, at.id, ownerId, 'transferido', 'humano', { autorId, deAtendente: at.atendente_id, paraAtendente: para, motivoId });
  }));

  router.post('/:id/resolver', acao('resolver', async ({ db, at, ownerId, autorId, body }) => {
    const motivoId = await motivoDaConta(db, ownerId, 'resolucao', body.motivo_id, true);
    await db.query(
      `UPDATE atendimentos SET estado = 'resolvido', resolvido_em = NOW(), resolvido_por = $2, motivo_resolucao_id = $3, updated_at = NOW() WHERE id = $1`,
      [at.id, autorId, motivoId]
    );
    await gravarEvento(db, at.id, ownerId, 'resolvido', 'humano', { autorId, motivoId });
    // Decisão 2 do plano: resolver devolve à IA, salvo pedido explícito.
    if (body.manter_ia_pausada !== true && await devolverIA(db, ownerId, at.telefone)) {
      await gravarEvento(db, at.id, ownerId, 'ia_retomada', 'humano', { autorId });
    }
  }));

  router.post('/:id/reabrir', acao('reabrir', async ({ db, at, ownerId, autorId }) => {
    await db.query(
      `UPDATE atendimentos SET estado = 'aberto', resolvido_em = NULL, resolvido_por = NULL, motivo_resolucao_id = NULL, updated_at = NOW() WHERE id = $1`,
      [at.id]
    );
    await gravarEvento(db, at.id, ownerId, 'reaberto', 'humano', { autorId });
  }));

  router.post('/:id/pausar-ia', acao('pausar-ia', async ({ db, at, ownerId, autorId, body }) => {
    const { minutos, erro } = lerMinutosPausa(body.minutos === undefined ? undefined : body.minutos);
    if (erro) throw new Recusa(400, erro);
    const motivoId = await motivoDaConta(db, ownerId, 'pausa', body.motivo_id, false);
    const ate = await pausarIA(db, ownerId, at.telefone, minutos ?? null);
    if (ate === undefined) throw new Recusa(409, 'Esta conversa ainda não tem contato salvo para pausar a IA.');
    await gravarEvento(db, at.id, ownerId, 'ia_pausada', 'humano', { autorId, motivoId, ate });
  }));

  router.post('/:id/devolver-ia', acao(null, async ({ db, at, ownerId, autorId }) => {
    if (await devolverIA(db, ownerId, at.telefone)) await gravarEvento(db, at.id, ownerId, 'ia_retomada', 'humano', { autorId });
  }));

  router.post('/:id/notas', acao(null, async ({ db, at, ownerId, autorId, body }) => {
    const { texto, erro } = lerNota(body.texto);
    if (erro) throw new Recusa(400, erro);
    await gravarEvento(db, at.id, ownerId, 'nota', 'humano', { autorId, texto });
  }));

  return router;
}

export function motivosRouter(pool: Pool): Router {
  const router = Router();

  const lerTipo = (v: unknown): TipoMotivo | null => (TIPOS_MOTIVO.includes(v as TipoMotivo) ? (v as TipoMotivo) : null);

  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const tipo = lerTipo(req.query.tipo);
      if (!tipo) return res.status(400).json({ message: 'Informe o tipo do motivo.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const padrao = MOTIVOS_PADRAO[tipo];
      // Excluir é desativar: a linha fica, então os padrões não voltam depois que a conta os apaga.
      if (padrao && !(await pool.query(`SELECT 1 FROM motivos WHERE user_id = $1 AND tipo = $2 LIMIT 1`, [ownerId, tipo])).rowCount) {
        for (const [ordem, nome] of padrao.entries()) {
          await pool.query(
            `INSERT INTO motivos (user_id, tipo, nome, ordem) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, tipo, lower(nome)) DO NOTHING`,
            [ownerId, tipo, nome, ordem]
          );
        }
      }
      const r = await pool.query(
        `SELECT id, tipo, nome, ativo, ordem FROM motivos WHERE user_id = $1 AND tipo = $2 AND ($3::boolean OR ativo) ORDER BY ordem, nome`,
        [ownerId, tipo, req.query.todos === '1']
      );
      return res.json(r.rows);
    } catch (err: any) { return erroHttp(res, err, 'Falha ao listar motivos'); }
  });

  const lerNome = (v: unknown): string | null => {
    const nome = typeof v === 'string' ? v.trim() : '';
    return nome && nome.length <= 80 ? nome : null;
  };

  router.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const tipo = lerTipo(req.body?.tipo);
      const nome = lerNome(req.body?.nome);
      if (!tipo || !nome) return res.status(400).json({ message: 'Informe o tipo e o nome do motivo (até 80 caracteres).' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `INSERT INTO motivos (user_id, tipo, nome, ordem) VALUES ($1, $2, $3, COALESCE($4::int, 0)) RETURNING id, tipo, nome, ativo, ordem`,
        [ownerId, tipo, nome, Number.isInteger(req.body?.ordem) ? req.body.ordem : null]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') return res.status(409).json({ message: 'Já existe um motivo com este nome.' });
      return erroHttp(res, err, 'Falha ao criar motivo');
    }
  });

  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.id)) return res.status(404).json({ message: 'Motivo não encontrado.' });
      const nome = req.body?.nome === undefined ? null : lerNome(req.body.nome);
      if (req.body?.nome !== undefined && !nome) return res.status(400).json({ message: 'Informe um nome de até 80 caracteres.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(
        `UPDATE motivos SET nome = COALESCE($3, nome), ativo = COALESCE($4::boolean, ativo), ordem = COALESCE($5::int, ordem)
         WHERE id = $1 AND user_id = $2 RETURNING id, tipo, nome, ativo, ordem`,
        [req.params.id, ownerId, nome, typeof req.body?.ativo === 'boolean' ? req.body.ativo : null, Number.isInteger(req.body?.ordem) ? req.body.ordem : null]
      );
      if (!r.rowCount) return res.status(404).json({ message: 'Motivo não encontrado.' });
      return res.json(r.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') return res.status(409).json({ message: 'Já existe um motivo com este nome.' });
      return erroHttp(res, err, 'Falha ao editar motivo');
    }
  });

  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      if (!ehUuid(req.params.id)) return res.status(404).json({ message: 'Motivo não encontrado.' });
      const ownerId = await resolverOwnerId(pool, req.userId!);
      const r = await pool.query(`UPDATE motivos SET ativo = false WHERE id = $1 AND user_id = $2`, [req.params.id, ownerId]);
      if (!r.rowCount) return res.status(404).json({ message: 'Motivo não encontrado.' });
      return res.json({ ok: true });
    } catch (err: any) { return erroHttp(res, err, 'Falha ao excluir motivo'); }
  });

  return router;
}
