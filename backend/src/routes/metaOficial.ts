/**
 * metaOficial.ts — números da WhatsApp API Oficial (Meta Cloud API) por conta: configuração,
 * teste de conexão, inscrição do app na WABA, uso do limite, eventos e templates.
 *
 * [AUDITORIA] LÓGICA (Sprint Estruturar API Oficial, 2026-09-06): rota própria (não cabe no CRUD
 * genérico) porque grava segredo criptografado (access_token/app_secret, AES-256 com
 * ENCRYPTION_KEY) — GET nunca devolve o valor nem o `_enc`, só `temAccessToken`/`temAppSecret`.
 *
 * [AUDITORIA] LÓGICA (Sprint 6, 2026-10-05):
 *   - H3: vários números oficiais por conta (`/configs`, uma linha por Phone Number ID). As rotas
 *     antigas `/config` e `/testar` continuam operando o 1º número (tela de Conectores);
 *   - H2: a resposta traz a URL do webhook e o Verify Token pra colar no app da Meta (antes a tela
 *     pedia o App Secret mas não mostrava nenhum dos dois); token regenerável; "Testar conexão"
 *     confere 4 coisas (número, WABA, app inscrito na WABA, último webhook recebido);
 *   - H4: templates da WABA — sincronizar, criar (com exemplos obrigatórios e "Parar promoções" em
 *     Marketing), excluir; alerta de texto promocional marcado como Utilidade.
 */
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';
import {
  encriptarSegredoMetaOficial, testarConexaoMetaOficial, buscarConfigMetaOficial, parseLimiteMensagens,
  graphFetch, buscarLimiteMensagens, versaoGraph,
} from '../services/metaCloudApi';
import { log } from '../logger';
import { avaliarOuCriarCampanhaOficial } from '../services/disparoOficial';
import { configuracaoCadastro, concluirCadastro } from '../services/embeddedSignup';

const API_BASE_URL = process.env.API_BASE_URL || 'https://api.mentoark.com.br';

const COLUNAS = `id, nome, numero_exibicao, phone_number_id, waba_id, verify_token, graph_api_version,
  ativo, ultima_conexao_em, ultimo_erro, quality_rating, messaging_limit_tier, max_conversas_dia,
  conta_status, alerta, alerta_em, ultimo_webhook_em, qualidade_atualizada_em, created_at,
  ia_ativa, agente_id, usar_mm_api, mm_onboarding_status, name_status, platform_type, verified_name,
  (access_token_enc IS NOT NULL) AS "temAccessToken", (app_secret_enc IS NOT NULL) AS "temAppSecret"`;

function formatar(row: any) {
  if (!row) return row;
  const tier = row.max_conversas_dia || row.messaging_limit_tier;
  const { valor, label } = parseLimiteMensagens(tier);
  return {
    ...row,
    limite_mensagens_valor: valor,
    limite_mensagens_label: label,
    webhook_url: `${API_BASE_URL}/webhook/meta/${row.id}`,
    graph_api_version: versaoGraph(row),
  };
}

// Motivos de rejeição de template mais comuns, em português (H4).
const MOTIVO_PT: Record<string, string> = {
  ABUSIVE_CONTENT: 'Conteúdo considerado abusivo pela Meta.',
  INCORRECT_CATEGORY: 'Categoria incorreta para o conteúdo (ex.: promoção marcada como Utilidade).',
  INVALID_FORMAT: 'Formato inválido: confira variáveis {{n}}, exemplos e tamanho do texto.',
  SCAM: 'Conteúdo considerado golpe ou fraude.',
  TAG_CONTENT_MISMATCH: 'O conteúdo não corresponde à categoria escolhida.',
  PROMOTIONAL: 'Conteúdo promocional — use a categoria Marketing.',
};
export function motivoRejeicaoPt(motivo: string | null | undefined): string | null {
  if (!motivo || motivo === 'NONE') return null;
  return MOTIVO_PT[motivo] ?? motivo;
}

const PALAVRAS_PROMO = /\b(promo[cç][aã]o|desconto|oferta|gr[aá]tis|compre|aproveite|cupom|liquida[cç][aã]o|black ?friday|% ?off|imperd[ií]vel)\b/i;

export default function metaOficialRouter(pool: Pool): Router {
  const router = Router();

  async function configDoUsuario(req: AuthRequest, id: string): Promise<any | null> {
    const r = await pool.query(`SELECT * FROM whatsapp_oficial_config WHERE id = $1 AND user_id = $2`, [id, req.userId]);
    return r.rows[0] || null;
  }

  async function salvar(userId: string, id: string | null, body: any) {
    const { nome, numero_exibicao, phone_number_id, waba_id, access_token, app_secret, graph_api_version, ativo } = body || {};
    if (!id) {
      const r = await pool.query(
        `INSERT INTO whatsapp_oficial_config
           (user_id, nome, numero_exibicao, phone_number_id, waba_id, access_token_enc, app_secret_enc, graph_api_version, ativo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'v21.0'),COALESCE($9,false))
         RETURNING ${COLUNAS}`,
        [userId, nome || null, numero_exibicao || null, phone_number_id || null, waba_id || null,
         access_token ? encriptarSegredoMetaOficial(access_token) : null,
         app_secret ? encriptarSegredoMetaOficial(app_secret) : null,
         graph_api_version || null, ativo ?? false]
      );
      return r.rows[0];
    }
    const sets = ['nome = COALESCE($3, nome)', 'numero_exibicao = $4', 'phone_number_id = $5', 'waba_id = $6', 'updated_at = NOW()'];
    const vals: any[] = [id, userId, nome || null, numero_exibicao || null, phone_number_id || null, waba_id || null];
    let i = 7;
    if (access_token) { sets.push(`access_token_enc = $${i++}`); vals.push(encriptarSegredoMetaOficial(access_token)); }
    if (app_secret) { sets.push(`app_secret_enc = $${i++}`); vals.push(encriptarSegredoMetaOficial(app_secret)); }
    if (graph_api_version) { sets.push(`graph_api_version = $${i++}`); vals.push(graph_api_version); }
    if (ativo !== undefined) { sets.push(`ativo = $${i++}`); vals.push(ativo); }
    const r = await pool.query(
      `UPDATE whatsapp_oficial_config SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING ${COLUNAS}`,
      vals
    );
    return r.rows[0] || null;
  }

  // ── Rotas antigas (tela de Conectores): operam o 1º número da conta ────────────────────────
  router.get('/config', async (req: AuthRequest, res: Response) => {
    try {
      const r = await pool.query(`SELECT ${COLUNAS} FROM whatsapp_oficial_config WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [req.userId]);
      return res.json(formatar(r.rows[0] || null));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  router.put('/config', async (req: AuthRequest, res: Response) => {
    try {
      const atual = await pool.query(`SELECT id FROM whatsapp_oficial_config WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [req.userId]);
      const row = await salvar(req.userId!, atual.rows[0]?.id ?? null, req.body);
      return res.status(atual.rows.length ? 200 : 201).json(formatar(row));
    } catch (err: any) {
      log.error('META_OFICIAL', 'Falha ao salvar config', { err: err?.message });
      return res.status(err?.code === '23505' ? 409 : 500).json({ message: err?.code === '23505' ? 'Esse Phone Number ID já está cadastrado nesta conta.' : err.message });
    }
  });

  router.post('/testar', async (req: AuthRequest, res: Response) => {
    const cfg = await buscarConfigMetaOficial(pool, req.userId!);
    if (!cfg) return res.status(404).json({ message: 'Nenhuma configuração encontrada — preencha e salve antes de testar.' });
    return res.json(await testarCompleto(cfg));
  });

  // ── Sprint 6 do maturador (2026-10-18): cadastro pela Meta (Embedded Signup v4) ─────────────
  router.get('/cadastro/config', (_req: AuthRequest, res: Response) => {
    const c = configuracaoCadastro();
    return res.json({ ...c, webhook_url: `${process.env.API_PUBLIC_URL || 'https://api.mentoark.com.br'}/webhook/meta/app` });
  });

  router.post('/cadastro/concluir', async (req: AuthRequest, res: Response) => {
    const b = req.body || {};
    const r = await concluirCadastro(pool, req.userId!, {
      code: String(b.code || ''), waba_id: String(b.waba_id || ''), phone_number_id: String(b.phone_number_id || ''),
      business_id: b.business_id ? String(b.business_id) : null, coexistencia: b.coexistencia === true,
    });
    if (r.erro) return res.status(r.etapas.length ? 502 : 400).json({ message: r.erro, etapas: r.etapas });
    return res.status(201).json(r);
  });

  // ── Vários números oficiais (Sprint 6 / H3) ────────────────────────────────────────────────
  router.get('/configs', async (req: AuthRequest, res: Response) => {
    const r = await pool.query(`SELECT ${COLUNAS} FROM whatsapp_oficial_config WHERE user_id = $1 ORDER BY created_at`, [req.userId]);
    return res.json(r.rows.map(formatar));
  });

  router.post('/configs', async (req: AuthRequest, res: Response) => {
    try {
      return res.status(201).json(formatar(await salvar(req.userId!, null, req.body)));
    } catch (err: any) {
      return res.status(err?.code === '23505' ? 409 : 500).json({ message: err?.code === '23505' ? 'Esse Phone Number ID já está cadastrado nesta conta.' : err.message });
    }
  });

  router.put('/configs/:id', async (req: AuthRequest, res: Response) => {
    try {
      const row = await salvar(req.userId!, req.params.id, req.body);
      if (!row) return res.status(404).json({ message: 'Número oficial não encontrado' });
      return res.json(formatar(row));
    } catch (err: any) {
      return res.status(err?.code === '23505' ? 409 : 500).json({ message: err?.code === '23505' ? 'Esse Phone Number ID já está cadastrado nesta conta.' : err.message });
    }
  });

  router.delete('/configs/:id', async (req: AuthRequest, res: Response) => {
    await pool.query(`DELETE FROM whatsapp_oficial_config WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
    return res.status(204).send();
  });

  router.post('/configs/:id/regenerar-token', async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `UPDATE whatsapp_oficial_config SET verify_token = encode(gen_random_bytes(16), 'hex'), updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING ${COLUNAS}`,
      [req.params.id, req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Número oficial não encontrado' });
    return res.json(formatar(r.rows[0]));
  });

  router.post('/configs/:id/testar', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    return res.json(await testarCompleto(cfg));
  });

  // Inscreve o app na WABA (sem isso a Meta não manda webhook nenhum desta WABA).
  router.post('/configs/:id/inscrever', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    if (!cfg.waba_id) return res.status(400).json({ message: 'Preencha o WABA ID antes.' });
    const r = await graphFetch(cfg, `${cfg.waba_id}/subscribed_apps`, { method: 'POST' });
    if (!r.ok) return res.status(502).json({ message: r.erro });
    return res.json({ ok: true });
  });

  // ── Sprint 7 / H6: IA no número oficial ────────────────────────────────────────────────────
  // Política da Meta (desde 15/01/2026): assistente de uso geral é proibido no canal oficial — só
  // liga com agente que tenha ESCOPO definido (e a passagem para humano da Sprint 3 / H9).
  router.put('/configs/:id/ia', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const ativa = req.body?.ia_ativa === true;
    const agenteId = req.body?.agente_id || cfg.agente_id || null;
    if (ativa) {
      if (!agenteId) return res.status(422).json({ message: 'Escolha o agente que vai atender neste número.' });
      const ag = (await pool.query(`SELECT nome, escopo_ia, ativo FROM agentes WHERE id = $1 AND user_id = $2`, [agenteId, req.userId])).rows[0];
      if (!ag) return res.status(404).json({ message: 'Agente não encontrado' });
      if (!String(ag.escopo_ia || '').trim()) {
        return res.status(422).json({
          code: 'SEM_ESCOPO',
          message: `O agente "${ag.nome}" não tem escopo definido. A Meta proíbe IA de uso geral na API oficial: defina o escopo (ex.: "agendamento de consultas") em Agentes antes de ligar.`,
        });
      }
    }
    const r = await pool.query(
      `UPDATE whatsapp_oficial_config SET ia_ativa = $3, agente_id = $4, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING ${COLUNAS}`,
      [cfg.id, req.userId, ativa, agenteId]
    );
    return res.json(formatar(r.rows[0]));
  });

  // ── Sprint 7 / H6: perfil do negócio ───────────────────────────────────────────────────────
  const CAMPOS_PERFIL = 'about,address,description,email,profile_picture_url,websites,vertical';
  router.get('/configs/:id/perfil', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const r = await graphFetch(cfg, `${cfg.phone_number_id}/whatsapp_business_profile?fields=${CAMPOS_PERFIL}`);
    if (!r.ok) return res.status(502).json({ message: r.erro });
    return res.json(r.data?.data?.[0] ?? {});
  });

  router.put('/configs/:id/perfil', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const v = validarPerfil(req.body || {});
    if (v.erro) return res.status(400).json({ message: v.erro });
    const r = await graphFetch(cfg, `${cfg.phone_number_id}/whatsapp_business_profile`, {
      method: 'POST', body: { messaging_product: 'whatsapp', ...v.perfil },
    });
    if (!r.ok) return res.status(502).json({ message: r.erro });
    return res.json({ ok: true });
  });

  // ── Sprint 7 / H6: registro do número na Cloud API + status do nome de exibição ────────────
  router.get('/configs/:id/registro', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const r = await graphFetch(cfg, `${cfg.phone_number_id}?fields=verified_name,name_status,platform_type,status,code_verification_status`);
    if (!r.ok) return res.status(502).json({ message: r.erro });
    await pool.query(
      `UPDATE whatsapp_oficial_config SET name_status = $2, platform_type = $3, verified_name = $4 WHERE id = $1`,
      [cfg.id, r.data?.name_status ?? null, r.data?.platform_type ?? null, r.data?.verified_name ?? null]
    ).catch(() => {});
    return res.json({ ...r.data, registrado: r.data?.platform_type === 'CLOUD_API', ...rotulosRegistro(r.data) });
  });

  router.post('/configs/:id/registrar', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const pin = String(req.body?.pin || '');
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ message: 'O PIN de confirmação em duas etapas tem 6 dígitos.' });
    // O PIN não é gravado nem logado — só repassado à Meta.
    const r = await graphFetch(cfg, `${cfg.phone_number_id}/register`, { method: 'POST', body: { messaging_product: 'whatsapp', pin } });
    if (!r.ok) return res.status(502).json({ message: r.erro });
    await pool.query(`UPDATE whatsapp_oficial_config SET platform_type = 'CLOUD_API' WHERE id = $1`, [cfg.id]).catch(() => {});
    return res.json({ ok: true });
  });

  // ── Sprint 7 / H7: Marketing Messages API ──────────────────────────────────────────────────
  // Flag por número, desligada por padrão. Se a WABA não estiver habilitada, a própria Meta envia
  // pela Cloud API normal (mesmo template, mesma cobrança) — ligar não quebra o envio.
  router.get('/configs/:id/mm-status', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    if (!cfg.waba_id) return res.status(400).json({ message: 'Preencha o WABA ID antes.' });
    const r = await graphFetch(cfg, `${cfg.waba_id}?fields=marketing_messages_onboarding_status`);
    if (!r.ok) return res.status(502).json({ message: r.erro });
    const status = r.data?.marketing_messages_onboarding_status ?? null;
    const texto = typeof status === 'string' ? status : status ? JSON.stringify(status) : null;
    await pool.query(`UPDATE whatsapp_oficial_config SET mm_onboarding_status = $2 WHERE id = $1`, [cfg.id, texto]).catch(() => {});
    return res.json({ status: texto });
  });

  router.put('/configs/:id/mm', async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `UPDATE whatsapp_oficial_config SET usar_mm_api = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING ${COLUNAS}`,
      [req.params.id, req.userId, req.body?.usar_mm_api === true]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Número oficial não encontrado' });
    return res.json(formatar(r.rows[0]));
  });

  // Uso do limite: contatos únicos que receberam mensagem nossa em 24h e na semana.
  router.get('/configs/:id/uso', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const r = await pool.query(
      `SELECT COUNT(DISTINCT destinatario) FILTER (WHERE criado_em >= NOW() - INTERVAL '24 hours')::int AS hoje,
              COUNT(DISTINCT destinatario) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days')::int AS semana,
              COUNT(*) FILTER (WHERE pricing_cobravel AND criado_em >= NOW() - INTERVAL '30 days')::int AS cobradas_30d
       FROM meta_mensagens_status WHERE config_id = $1`,
      [cfg.id]
    );
    const erros = await pool.query(
      `SELECT erro_codigo AS codigo, COUNT(*)::int AS total FROM meta_mensagens_status
       WHERE config_id = $1 AND erro_codigo IS NOT NULL AND atualizado_em >= NOW() - INTERVAL '7 days'
       GROUP BY 1 ORDER BY 2 DESC`,
      [cfg.id]
    );
    // O limite é do PORTFÓLIO: soma o uso de todos os números oficiais da mesma WABA nesta conta.
    const portfolio = await pool.query(
      `SELECT COUNT(DISTINCT s.destinatario)::int AS hoje FROM meta_mensagens_status s
       JOIN whatsapp_oficial_config c ON c.id = s.config_id
       WHERE c.user_id = $1 AND c.waba_id = $2 AND s.criado_em >= NOW() - INTERVAL '24 hours'`,
      [req.userId, cfg.waba_id]
    );
    return res.json({ ...r.rows[0], portfolio_hoje: portfolio.rows[0]?.hoje ?? 0, erros_7d: erros.rows });
  });

  // ── Campanha pelo canal oficial (Sprint 6 / H5) ────────────────────────────────────────────
  // `estimar` não grava nada: devolve elegíveis, bloqueados por motivo e custo estimado; `criar`
  // repete a mesma avaliação no servidor e monta a fila só com os elegíveis.
  router.post('/configs/:id/campanhas/estimar', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const r: any = await avaliarOuCriarCampanhaOficial(pool, req.userId!, cfg, req.body, false);
    return r.erro && r.selecionados === undefined ? res.status(422).json({ message: r.erro }) : res.json(r);
  });

  router.post('/configs/:id/campanhas', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    if (!cfg.ativo) return res.status(422).json({ message: 'Ative o número oficial antes de disparar.' });
    const r: any = await avaliarOuCriarCampanhaOficial(pool, req.userId!, cfg, req.body, true);
    if (r.erro) return res.status(422).json({ message: r.erro, ...r });
    return res.status(201).json(r);
  });

  // Custo real: mensagens cobráveis (pricing.billable do webhook) × preço da categoria.
  router.get('/campanhas/:disparoId/custo', async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `SELECT s.pricing_categoria AS categoria, COUNT(*)::int AS cobradas, MAX(p.preco_usd) AS preco_usd,
              (COUNT(*) * MAX(p.preco_usd))::numeric(12,4) AS custo_usd
       FROM disparo_logs l JOIN disparos d ON d.id = l.disparo_id AND d.user_id = $2
       JOIN meta_mensagens_status s ON s.message_id = l.message_id
       LEFT JOIN precos_meta p ON p.pais = 'BR' AND p.categoria = s.pricing_categoria
       WHERE l.disparo_id = $1 AND s.pricing_cobravel
       GROUP BY 1`,
      [req.params.disparoId, req.userId]
    );
    const estimado = await pool.query(`SELECT custo_estimado_usd FROM disparos WHERE id = $1 AND user_id = $2`, [req.params.disparoId, req.userId]);
    return res.json({ estimado_usd: estimado.rows[0]?.custo_estimado_usd ?? null, por_categoria: r.rows,
      real_usd: r.rows.reduce((s: number, x: any) => s + Number(x.custo_usd || 0), 0) });
  });

  router.get('/configs/:id/eventos', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const r = await pool.query(
      `SELECT tipo, status_reason, detalhe, criado_em FROM whatsapp_eventos_saude
       WHERE instancia = $1 ORDER BY criado_em DESC LIMIT 30`,
      [`meta_oficial:${cfg.phone_number_id}`]
    );
    return res.json(r.rows);
  });

  // ── Templates da Meta (Sprint 6 / H4) ──────────────────────────────────────────────────────
  router.get('/configs/:id/templates', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const r = await pool.query(
      `SELECT id, meta_id, nome, idioma, categoria, status, motivo_rejeicao, componentes, atualizado_em
       FROM meta_templates WHERE config_id = $1 ORDER BY nome, idioma`,
      [cfg.id]
    );
    return res.json(r.rows.map(t => ({ ...t, motivo_rejeicao_pt: motivoRejeicaoPt(t.motivo_rejeicao) })));
  });

  router.post('/configs/:id/templates/sincronizar', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    try {
      const n = await sincronizarTemplates(pool, cfg);
      return res.json({ sincronizados: n });
    } catch (err: any) {
      return res.status(502).json({ message: err.message });
    }
  });

  router.post('/configs/:id/templates', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const v = validarTemplate(req.body || {});
    if (v.erro) return res.status(400).json({ message: v.erro });
    if (v.aviso && req.body?.confirmar_categoria !== true) {
      return res.status(422).json({ message: v.aviso, code: 'CATEGORIA_SUSPEITA' });
    }
    const r = await graphFetch(cfg, `${cfg.waba_id}/message_templates`, {
      method: 'POST',
      body: { name: v.nome, language: v.idioma, category: v.categoria, components: v.componentes },
    });
    if (!r.ok) return res.status(502).json({ message: r.erro });
    await pool.query(
      `INSERT INTO meta_templates (config_id, user_id, meta_id, nome, idioma, categoria, status, componentes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (config_id, nome, idioma) DO UPDATE SET meta_id = EXCLUDED.meta_id, categoria = EXCLUDED.categoria,
         status = EXCLUDED.status, componentes = EXCLUDED.componentes, motivo_rejeicao = NULL, atualizado_em = NOW()`,
      [cfg.id, req.userId, r.data?.id ?? null, v.nome, v.idioma, r.data?.category || v.categoria, r.data?.status || 'PENDING', JSON.stringify(v.componentes)]
    );
    return res.status(201).json({ id: r.data?.id, status: r.data?.status || 'PENDING', categoria: r.data?.category || v.categoria });
  });

  router.delete('/configs/:id/templates/:nome', async (req: AuthRequest, res: Response) => {
    const cfg = await configDoUsuario(req, req.params.id);
    if (!cfg) return res.status(404).json({ message: 'Número oficial não encontrado' });
    const r = await graphFetch(cfg, `${cfg.waba_id}/message_templates?name=${encodeURIComponent(req.params.nome)}`, { method: 'DELETE' });
    if (!r.ok) return res.status(502).json({ message: r.erro });
    await pool.query(`DELETE FROM meta_templates WHERE config_id = $1 AND nome = $2`, [cfg.id, req.params.nome]);
    return res.status(204).send();
  });

  // ── Teste de conexão em 4 etapas (Sprint 6 / H2) ───────────────────────────────────────────
  async function testarCompleto(cfg: any) {
    const etapas: { etapa: string; ok: boolean; detalhe: string; acao?: string }[] = [];
    const numero = await testarConexaoMetaOficial(cfg);
    etapas.push({
      etapa: 'Token acessa o número (Phone Number ID)', ok: numero.ok,
      detalhe: numero.ok ? `${numero.nomeVerificado || '—'} · ${numero.numeroExibicao || ''} · qualidade ${numero.qualidade || '—'}` : (numero.erro || 'falhou'),
    });
    if (!cfg.waba_id) {
      etapas.push({ etapa: 'Token acessa a WABA', ok: false, detalhe: 'WABA ID não preenchido.' });
      etapas.push({ etapa: 'App inscrito na WABA', ok: false, detalhe: 'WABA ID não preenchido.' });
    } else {
      const waba = await graphFetch(cfg, `${cfg.waba_id}?fields=id,name`);
      etapas.push({ etapa: 'Token acessa a WABA', ok: waba.ok, detalhe: waba.ok ? (waba.data?.name || waba.data?.id) : (waba.erro || 'falhou') });
      const sub = await graphFetch(cfg, `${cfg.waba_id}/subscribed_apps`);
      const inscrito = sub.ok && Array.isArray(sub.data?.data) && sub.data.data.length > 0;
      etapas.push({
        etapa: 'App inscrito na WABA (recebe webhooks)', ok: inscrito,
        detalhe: inscrito ? 'inscrito' : (sub.ok ? 'o app ainda não está inscrito nesta WABA' : (sub.erro || 'falhou')),
        acao: inscrito ? undefined : 'inscrever',
      });
    }
    etapas.push({
      etapa: 'Último webhook recebido', ok: !!cfg.ultimo_webhook_em,
      detalhe: cfg.ultimo_webhook_em ? new Date(cfg.ultimo_webhook_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'nenhum webhook recebido ainda',
    });
    await pool.query(
      `UPDATE whatsapp_oficial_config
       SET ultima_conexao_em = CASE WHEN $2 THEN NOW() ELSE ultima_conexao_em END, ultimo_erro = $3,
           quality_rating = COALESCE($4, quality_rating), messaging_limit_tier = COALESCE($5, messaging_limit_tier)
       WHERE id = $1`,
      [cfg.id, numero.ok, numero.ok ? null : (numero.erro || null), numero.qualidade || null, numero.limiteTier || null]
    ).catch(() => {});
    return { ...numero, ok: etapas.every(e => e.ok), etapas };
  }

  return router;
}

// ── Templates: validação e sincronização ─────────────────────────────────────────────────────
export function validarTemplate(b: any): {
  erro?: string; aviso?: string; nome?: string; idioma?: string; categoria?: string; componentes?: any[];
} {
  const nome = String(b.nome || '').trim();
  if (!/^[a-z0-9_]{1,512}$/.test(nome)) return { erro: 'Nome do template: só letras minúsculas, números e "_" (ex.: boas_vindas_outubro).' };
  const categoria = String(b.categoria || '').toUpperCase();
  if (!['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(categoria)) return { erro: 'Categoria deve ser Marketing, Utilidade ou Autenticação.' };
  const idioma = String(b.idioma || 'pt_BR');
  const corpo = String(b.corpo || '').trim();
  if (!corpo) return { erro: 'O corpo do template é obrigatório.' };
  if (corpo.length > 1024) return { erro: 'O corpo passa de 1024 caracteres.' };
  const vars = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
  const unicas = [...new Set(vars)].sort((a, b2) => a - b2);
  if (unicas.some((v, i) => v !== i + 1)) return { erro: 'As variáveis do corpo precisam ser {{1}}, {{2}}… em sequência, sem pular números.' };
  const exemplos: string[] = Array.isArray(b.exemplos) ? b.exemplos.map((e: unknown) => String(e || '').trim()) : [];
  if (unicas.length && (exemplos.length < unicas.length || exemplos.some(e => !e))) {
    return { erro: `A Meta exige um exemplo para cada variável (${unicas.length} variável(is)).` };
  }
  const componentes: any[] = [];
  if (String(b.cabecalho || '').trim()) componentes.push({ type: 'HEADER', format: 'TEXT', text: String(b.cabecalho).trim().slice(0, 60) });
  componentes.push(unicas.length ? { type: 'BODY', text: corpo, example: { body_text: [exemplos.slice(0, unicas.length)] } } : { type: 'BODY', text: corpo });
  if (String(b.rodape || '').trim()) componentes.push({ type: 'FOOTER', text: String(b.rodape).trim().slice(0, 60) });
  const botoes: string[] = (Array.isArray(b.botoes) ? b.botoes : []).map((x: unknown) => String(x || '').trim()).filter(Boolean);
  if (categoria === 'MARKETING' && !botoes.some(t => /parar promo/i.test(t))) botoes.push('Parar promoções');
  if (botoes.length) componentes.push({ type: 'BUTTONS', buttons: botoes.slice(0, 10).map(t => ({ type: 'QUICK_REPLY', text: t.slice(0, 25) })) });
  const aviso = categoria === 'UTILITY' && PALAVRAS_PROMO.test(corpo)
    ? 'O texto parece promocional, mas está como Utilidade. A Meta costuma reclassificar para Marketing (custo maior) e isso pesa na qualidade. Mude para Marketing ou confirme.'
    : undefined;
  return { nome, idioma, categoria, componentes, aviso };
}

export async function sincronizarTemplates(pool: Pool, cfg: any): Promise<number> {
  if (!cfg.waba_id) throw new Error('Preencha o WABA ID antes de sincronizar.');
  let path = `${cfg.waba_id}/message_templates?fields=id,name,language,category,status,rejected_reason,components&limit=100`;
  let n = 0;
  for (let pagina = 0; pagina < 20 && path; pagina++) {
    const r = await graphFetch(cfg, path);
    if (!r.ok) throw new Error(r.erro || 'Falha ao listar templates na Meta');
    for (const t of r.data?.data || []) {
      await pool.query(
        `INSERT INTO meta_templates (config_id, user_id, meta_id, nome, idioma, categoria, status, motivo_rejeicao, componentes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (config_id, nome, idioma) DO UPDATE SET meta_id = EXCLUDED.meta_id, categoria = EXCLUDED.categoria,
           status = EXCLUDED.status, motivo_rejeicao = EXCLUDED.motivo_rejeicao, componentes = EXCLUDED.componentes, atualizado_em = NOW()`,
        [cfg.id, cfg.user_id, t.id, t.name, t.language, t.category, t.status, t.rejected_reason || null, JSON.stringify(t.components || [])]
      );
      n++;
    }
    const proxima: string | undefined = r.data?.paging?.next;
    path = proxima ? proxima.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, '') : '';
  }
  return n;
}

/** Cron (a cada 6h): sincroniza templates e atualiza qualidade/limite de todos os números ativos. */
export async function atualizarNumerosOficiais(pool: Pool): Promise<{ numeros: number; templates: number }> {
  const r = await pool.query(`SELECT * FROM whatsapp_oficial_config WHERE ativo = true AND access_token_enc IS NOT NULL AND phone_number_id IS NOT NULL`);
  let templates = 0;
  for (const cfg of r.rows) {
    try {
      const q = await graphFetch(cfg, `${cfg.phone_number_id}?fields=quality_rating,name_status,platform_type,verified_name`);
      const limite = await buscarLimiteMensagens(cfg).catch(() => null);
      const d = q.ok ? q.data || {} : {};
      await pool.query(
        `UPDATE whatsapp_oficial_config SET quality_rating = COALESCE($2, quality_rating),
                messaging_limit_tier = COALESCE($3, messaging_limit_tier), qualidade_atualizada_em = NOW(),
                name_status = COALESCE($4, name_status), platform_type = COALESCE($5, platform_type),
                verified_name = COALESCE($6, verified_name)
         WHERE id = $1`,
        [cfg.id, d.quality_rating ?? null, limite, d.name_status ?? null, d.platform_type ?? null, d.verified_name ?? null]
      );
      if (cfg.waba_id) templates += await sincronizarTemplates(pool, cfg);
    } catch (err: any) {
      log.warn('META_OFICIAL', 'Falha ao atualizar número oficial', { configId: cfg.id, err: err?.message });
    }
  }
  return { numeros: r.rows.length, templates };
}

// ── Sprint 7 / H6: perfil do negócio e registro ──────────────────────────────────────────────
export const SETORES_META: Record<string, string> = {
  AUTO: 'Automotivo', BEAUTY: 'Beleza e estética', APPAREL: 'Roupas e acessórios', EDU: 'Educação',
  ENTERTAIN: 'Entretenimento', EVENT_PLAN: 'Eventos', FINANCE: 'Finanças', GROCERY: 'Mercado',
  GOVT: 'Governo', HOTEL: 'Hotelaria', HEALTH: 'Saúde', NONPROFIT: 'Sem fins lucrativos',
  PROF_SERVICES: 'Serviços profissionais', RETAIL: 'Varejo', TRAVEL: 'Viagens', RESTAURANT: 'Restaurante', OTHER: 'Outro',
};

/** Limites de tamanho da Meta para o perfil do negócio. Só envia os campos que vieram no corpo. */
export function validarPerfil(b: any): { erro?: string; perfil?: Record<string, unknown> } {
  const perfil: Record<string, unknown> = {};
  const texto = (campo: string, max: number, rotulo: string): string | null => {
    if (b[campo] === undefined) return null;
    const v = String(b[campo] ?? '').trim();
    if (v.length > max) return `${rotulo}: máximo de ${max} caracteres.`;
    perfil[campo] = v;
    return null;
  };
  const erro = texto('about', 139, 'Recado') || texto('description', 512, 'Descrição') || texto('address', 256, 'Endereço') || texto('email', 128, 'E-mail');
  if (erro) return { erro };
  if (perfil.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(perfil.email))) return { erro: 'E-mail inválido.' };
  if (b.websites !== undefined) {
    const sites = (Array.isArray(b.websites) ? b.websites : [b.websites]).map((s: unknown) => String(s || '').trim()).filter(Boolean);
    if (sites.length > 2) return { erro: 'A Meta aceita no máximo 2 sites.' };
    if (sites.some((s: string) => !/^https?:\/\//i.test(s) || s.length > 256)) return { erro: 'Site precisa começar com http:// ou https:// (até 256 caracteres).' };
    perfil.websites = sites;
  }
  if (b.vertical !== undefined && b.vertical !== '') {
    if (!SETORES_META[String(b.vertical)]) return { erro: 'Setor inválido.' };
    perfil.vertical = String(b.vertical);
  }
  return { perfil };
}

const NOME_STATUS_PT: Record<string, string> = {
  APPROVED: 'Nome aprovado', AVAILABLE_WITHOUT_REVIEW: 'Nome liberado (sem revisão)', PENDING_REVIEW: 'Nome em análise',
  DECLINED: 'Nome recusado', EXPIRED: 'Pedido de nome expirado', NON_EXISTS: 'Sem nome cadastrado', NONE: 'Sem nome cadastrado',
};
export function rotulosRegistro(d: any): { nome_status_pt: string | null; registro_pt: string } {
  return {
    nome_status_pt: d?.name_status ? (NOME_STATUS_PT[d.name_status] ?? d.name_status) : null,
    registro_pt: d?.platform_type === 'CLOUD_API' ? 'Registrado na Cloud API'
      : d?.platform_type === 'ON_PREMISE' ? 'Registrado na API On-Premises (migre para Cloud API)'
      : 'Ainda não registrado na Cloud API',
  };
}
