/**
 * canais.ts — Canais de WhatsApp (2026-10-30, modelo Cubo `/settings/channels`): cada número com o
 * agente de IA que responde por ele. Ver services/canais.ts.
 *
 *   GET /api/canais                 → números (QR Code e oficiais) + agentes disponíveis
 *   PUT /api/canais/numero/:id      → número QR Code: { ia_ativa?, agente_resposta_id? }
 *   (número oficial: PUT /api/meta-oficial/configs/:id/ia, que já cobra o escopo exigido pela Meta)
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function canaisRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const [numeros, oficiais, agentes] = await Promise.all([
        pool.query(
          `SELECT id, nome, nome_exibicao, evolution_instancia, numero_conectado, ativo, papel,
                  agente_resposta_id, protecao_alerta, evolution_conectado_em
             FROM agentes WHERE user_id = $1 AND COALESCE(evolution_instancia, '') <> ''
            ORDER BY created_at`, [req.userId]),
        pool.query(
          `SELECT id, nome, numero_exibicao, verified_name, ativo, ia_ativa, agente_id, quality_rating,
                  messaging_limit_tier, ultimo_erro
             FROM whatsapp_oficial_config WHERE user_id = $1 ORDER BY created_at`, [req.userId]),
        pool.query(
          `SELECT id, nome, ativo, modelo, COALESCE(evolution_instancia, '') <> '' AS eh_numero,
                  COALESCE(length(trim(prompt_sistema)), 0) > 0 AS tem_prompt,
                  COALESCE(length(trim(escopo_ia)), 0) > 0 AS tem_escopo
             FROM agentes WHERE user_id = $1 ORDER BY nome`, [req.userId]),
      ]);

      const canais = [
        ...numeros.rows.map((n: any) => ({
          id: n.id, provider: 'evolution' as const,
          nome: n.nome_exibicao || n.nome || n.evolution_instancia,
          instancia: n.evolution_instancia,
          numero: n.numero_conectado ? `+${n.numero_conectado}` : null,
          conectado: !!n.numero_conectado,
          pessoal: n.papel === 'pessoal',
          alerta: n.protecao_alerta || null,
          ia_ativa: !!n.ativo,
          // NULL = a própria linha responde (o número "é" o agente).
          agente_id: n.agente_resposta_id || n.id,
          agente_proprio: !n.agente_resposta_id || n.agente_resposta_id === n.id,
        })),
        ...oficiais.rows.map((o: any) => ({
          id: o.id, provider: 'meta_cloud' as const,
          nome: o.nome || o.verified_name || o.numero_exibicao || 'Número oficial',
          instancia: null, numero: o.numero_exibicao, conectado: !!o.ativo && !o.ultimo_erro,
          pessoal: false, alerta: o.ultimo_erro || (o.quality_rating && o.quality_rating !== 'GREEN' ? `Qualidade ${o.quality_rating}` : null),
          ia_ativa: !!o.ia_ativa, agente_id: o.agente_id || null, agente_proprio: false,
          qualidade: o.quality_rating, limite: o.messaging_limit_tier,
        })),
      ];
      return res.json({ canais, agentes: agentes.rows });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.put('/numero/:id', async (req: AuthRequest, res: Response) => {
    try {
      const num = (await pool.query(
        `SELECT id, papel FROM agentes WHERE id = $1 AND user_id = $2 AND COALESCE(evolution_instancia, '') <> ''`,
        [req.params.id, req.userId])).rows[0];
      if (!num) return res.status(404).json({ message: 'Número não encontrado' });

      const sets: string[] = [];
      const vals: any[] = [num.id, req.userId];
      if (req.body?.agente_resposta_id !== undefined) {
        const alvo = req.body.agente_resposta_id || null;
        if (alvo && alvo !== num.id) {
          const ag = (await pool.query(
            `SELECT nome, ativo, COALESCE(length(trim(prompt_sistema)), 0) > 0 AS tem_prompt FROM agentes WHERE id = $1 AND user_id = $2`,
            [alvo, req.userId])).rows[0];
          if (!ag) return res.status(404).json({ message: 'Agente não encontrado' });
          if (!ag.tem_prompt) return res.status(422).json({ message: `O agente "${ag.nome}" não tem prompt: ele não responderia ninguém.` });
        }
        vals.push(alvo && alvo !== num.id ? alvo : null);
        sets.push(`agente_resposta_id = $${vals.length}`);
      }
      if (typeof req.body?.ia_ativa === 'boolean') {
        if (req.body.ia_ativa && num.papel === 'pessoal') {
          return res.status(422).json({ message: 'Este número está marcado como pessoal: a IA nunca responde nele.' });
        }
        vals.push(req.body.ia_ativa);
        sets.push(`ativo = $${vals.length}`);
      }
      if (!sets.length) return res.status(400).json({ message: 'Nada para atualizar' });
      await pool.query(`UPDATE agentes SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND user_id = $2`, vals);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
