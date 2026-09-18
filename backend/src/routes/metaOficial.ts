/**
 * metaOficial.ts — CRUD autenticado da configuração do canal WhatsApp API Oficial (Meta Cloud
 * API) por tenant, e botão "Testar conexão".
 *
 * [AUDITORIA] LÓGICA (Sprint Estruturar API Oficial, 2026-09-06): rota própria (não cabe no CRUD
 * genérico de crud.ts) porque grava segredo criptografado (access_token/app_secret) — precisa de
 * lógica de criptografia na escrita e omissão total na leitura, o mesmo motivo já documentado em
 * `ai-providers.ts` pra `api_key_enc`. GET nunca devolve o valor cru nem o `_enc` — só um booleano
 * "está configurado" (`temAccessToken`/`temAppSecret`), suficiente pro frontend saber o que
 * mostrar sem nunca reexibir o segredo depois de salvo uma vez.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import { encriptarSegredoMetaOficial, testarConexaoMetaOficial, buscarConfigMetaOficial, parseLimiteMensagens } from '../services/metaCloudApi';
import { log } from '../logger';

export default function metaOficialRouter(pool: Pool): Router {
  const router = Router();

  // GET /api/meta-oficial/config
  router.get('/config', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT id, numero_exibicao, phone_number_id, waba_id, verify_token, graph_api_version,
                ativo, ultima_conexao_em, ultimo_erro, quality_rating, messaging_limit_tier,
                (access_token_enc IS NOT NULL) AS "temAccessToken",
                (app_secret_enc IS NOT NULL) AS "temAppSecret"
         FROM whatsapp_oficial_config WHERE user_id = $1 LIMIT 1`,
        [req.userId]
      );
      const row = r.rows[0] || null;
      if (row) {
        const { valor, label } = parseLimiteMensagens(row.messaging_limit_tier);
        row.limite_mensagens_valor = valor;
        row.limite_mensagens_label = label;
      }
      return res.json(row);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // PUT /api/meta-oficial/config — upsert. `access_token`/`app_secret` só entram no UPDATE
  // quando o operador realmente digitou um valor novo (campo vazio = "não mudar o que já está
  // salvo", nunca apaga um segredo já configurado por engano ao só trocar o phone_number_id).
  router.put('/config', async (req: AuthRequest, res: Response) => {
    try {
      const { numero_exibicao, phone_number_id, waba_id, access_token, app_secret, graph_api_version, ativo } = req.body || {};

      const existente = await pool.query(`SELECT id FROM whatsapp_oficial_config WHERE user_id = $1`, [req.userId]);

      if (!existente.rows.length) {
        const r = await pool.query(
          `INSERT INTO whatsapp_oficial_config
             (user_id, numero_exibicao, phone_number_id, waba_id, access_token_enc, app_secret_enc, graph_api_version, ativo)
           VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'v21.0'),COALESCE($8,false))
           RETURNING id, verify_token`,
          [
            req.userId, numero_exibicao || null, phone_number_id || null, waba_id || null,
            access_token ? encriptarSegredoMetaOficial(access_token) : null,
            app_secret ? encriptarSegredoMetaOficial(app_secret) : null,
            graph_api_version || null, ativo ?? false,
          ]
        );
        return res.status(201).json(r.rows[0]);
      }

      const sets: string[] = ['numero_exibicao = $2', 'phone_number_id = $3', 'waba_id = $4', 'updated_at = NOW()'];
      const vals: any[] = [req.userId, numero_exibicao || null, phone_number_id || null, waba_id || null];
      let idx = 5;
      if (access_token) { sets.push(`access_token_enc = $${idx++}`); vals.push(encriptarSegredoMetaOficial(access_token)); }
      if (app_secret) { sets.push(`app_secret_enc = $${idx++}`); vals.push(encriptarSegredoMetaOficial(app_secret)); }
      if (graph_api_version) { sets.push(`graph_api_version = $${idx++}`); vals.push(graph_api_version); }
      if (ativo !== undefined) { sets.push(`ativo = $${idx++}`); vals.push(ativo); }

      const r = await pool.query(
        `UPDATE whatsapp_oficial_config SET ${sets.join(', ')} WHERE user_id = $1 RETURNING id, verify_token`,
        vals
      );
      return res.json(r.rows[0]);
    } catch (err: any) {
      log.error('META_OFICIAL', 'Falha ao salvar config', { err: err?.message });
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/meta-oficial/testar — chamada leve (GET na Graph API) só pra confirmar que
  // phone_number_id + access_token realmente correspondem a um número válido.
  router.post('/testar', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await buscarConfigMetaOficial(pool, req.userId!);
      if (!cfg) return res.status(404).json({ message: 'Nenhuma configuração encontrada — preencha e salve antes de testar.' });

      const resultado = await testarConexaoMetaOficial(cfg);
      await pool.query(
        `UPDATE whatsapp_oficial_config
         SET ultima_conexao_em = CASE WHEN $2 THEN NOW() ELSE ultima_conexao_em END,
             ultimo_erro = $3,
             quality_rating = COALESCE($4, quality_rating),
             messaging_limit_tier = COALESCE($5, messaging_limit_tier)
         WHERE id = $1`,
        [cfg.id, resultado.ok, resultado.erro || null, resultado.qualidade || null, resultado.limiteTier || null]
      ).catch(() => {});

      return res.json(resultado);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
