/**
 * routes/smartLinks.ts — Smart Links & QR Code + KPI inbound × outbound (Sprint 3 / H7, 2026-10-05).
 *
 * [AUDITORIA] BUG CORRIGIDO: a página /smart-links era só maquete (botão "Gerar Link" sem ação,
 * link e contadores fixos no código). Agora:
 *   - CRUD autenticado em /api/smart-links;
 *   - link público GET /l/:codigo (montado sem auth em index.ts) → conta o clique e redireciona
 *     pro wa.me da instância com a mensagem pré-preenchida + "(cód. XXXXXX)";
 *   - o webhook reconhece o código na 1ª mensagem (`registrarOrigemInbound`) e marca o contato;
 *   - GET /api/smart-links/kpi: % de conversas iniciadas pelo cliente (inbound) por instância.
 */
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { AuthRequest } from '../middleware';
import { log } from '../logger';
import { registrarAtribuicao } from '../services/atribuicaoAnuncio';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I — fácil de ler e digitar
function gerarCodigo(): string {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, b => ALFABETO[b % ALFABETO.length]).join('');
}
const REGEX_CODIGO = /c[oó]d\.?\s*:?\s*([A-HJ-NP-Z2-9]{6})\b/i;
const ORIGENS = ['campanha', 'anuncio', 'bio', 'qr', 'outro'];

export function textoDoLink(mensagem: string, codigo: string): string {
  return `${mensagem.trim()} (cód. ${codigo})`;
}

/**
 * Chamado pelo webhook na mensagem recebida (1:1). Primeiro toque vence: só marca a origem se o
 * contato ainda não tiver uma. Reconhece o código do Smart Link no texto e anúncio CTWA pelo
 * `externalAdReply`. Nunca lança.
 */
export async function registrarOrigemInbound(pool: Pool, userId: string, telefone: string, texto: string | null, data: any): Promise<void> {
  try {
    const sufixo = `%${String(telefone).replace(/\D/g, '').slice(-11)}`;
    const ctx = data?.contextInfo || data?.message?.extendedTextMessage?.contextInfo || data?.message?.contextInfo || null;
    const anuncio = ctx?.externalAdReply || null;
    const m = String(texto || '').match(REGEX_CODIGO);

    let tipo: string | null = null;
    let linkId: string | null = null;
    let campanha: string | null = null;
    if (m) {
      const link = await pool.query(
        `SELECT id, origem, campanha, nome FROM smart_links WHERE user_id = $1 AND codigo = $2 LIMIT 1`,
        [userId, m[1].toUpperCase()]
      );
      if (link.rows[0]) {
        linkId = link.rows[0].id;
        tipo = link.rows[0].origem;
        campanha = link.rows[0].campanha || link.rows[0].nome;
      }
    }
    if (!tipo && anuncio) {
      tipo = 'anuncio';
      campanha = String(anuncio.title || anuncio.sourceId || 'Anúncio clique-para-WhatsApp').slice(0, 200);
    }
    // Sprint M1 (2026-10-06): todo toque de anúncio vira atribuição (não só o primeiro). Só conta
    // quando há id do anúncio ou do clique — `externalAdReply` também aparece em prévia de link
    // comum. [AUDITORIA] FIX PENDENTE (motivo: formato não confirmado ao vivo): os nomes
    // `sourceId`/`sourceType`/`ctwaClid` seguem o proto do Baileys; confirmar com um clique real
    // em anúncio num número da Evolution (payload cru fica em atribuicoes_anuncio.payload).
    if (anuncio && (anuncio.sourceId || anuncio.ctwaClid)) {
      const ehAnuncio = !anuncio.sourceType || String(anuncio.sourceType).toLowerCase() === 'ad';
      void registrarAtribuicao(pool, {
        userId, canal: 'ctwa', telefone,
        ctwaClid: anuncio.ctwaClid ?? null,
        adId: ehAnuncio ? anuncio.sourceId ?? null : null,
        sourceType: anuncio.sourceType ?? null, sourceUrl: anuncio.sourceUrl ?? null, headline: anuncio.title ?? null,
        payload: { ...anuncio, thumbnail: undefined, jpegThumbnail: undefined, origem: 'evolution' },
      });
    }
    // Sprint 6 / opt-in (2026-10-05): consentimento pra API Oficial. Smart Link/anúncio contam como
    // opt-in; sem link, só conta quem escreveu PRIMEIRO (nunca recebeu disparo nosso) — resposta a
    // prospecção fria não é consentimento. Primeiro registro vence (não sobrescreve).
    await pool.query(
      `UPDATE contatos SET optin_origem = $3, optin_em = NOW(), optin_prova = $4
       WHERE user_id = $1 AND telefone ILIKE $2 AND optin_origem IS NULL
         AND ($3 <> 'conversa_iniciada_pelo_contato' OR ultimo_disparo_em IS NULL)`,
      [userId, sufixo, tipo === 'anuncio' ? 'anuncio_ctwa' : tipo ? 'smart_link' : 'conversa_iniciada_pelo_contato',
       String(texto || '').slice(0, 200) || null]
    ).catch(() => {});
    if (!tipo) return;

    const upd = await pool.query(
      `UPDATE contatos SET origem_inbound_em = NOW(), origem_inbound_tipo = $3, origem_inbound_link_id = $4,
              origem_inbound_campanha = $5, updated_at = NOW()
       WHERE user_id = $1 AND telefone ILIKE $2 AND origem_inbound_em IS NULL
       RETURNING id`,
      [userId, sufixo, tipo, linkId, campanha]
    );
    if (!upd.rowCount) return; // já tinha origem — primeiro toque vence
    if (linkId) await pool.query(`UPDATE smart_links SET leads = leads + 1 WHERE id = $1`, [linkId]).catch(() => {});
    await pool.query(
      `INSERT INTO timeline_eventos (contato_id, user_id, tipo, titulo, descricao) VALUES ($1, $2, 'sistema', $3, $4)`,
      [upd.rows[0].id, userId, 'Chegou por inbound', `Origem: ${tipo}${campanha ? ` — ${campanha}` : ''}`]
    ).catch(() => {});
    log.info('SMART_LINKS', 'Origem inbound registrada', { userId, tipo, linkId });
  } catch (err: any) {
    log.warn('SMART_LINKS', 'Falha ao registrar origem inbound', { userId, err: err?.message });
  }
}

/** GET /l/:codigo — público: conta o clique e redireciona pro WhatsApp. */
export function smartLinkPublico(pool: Pool) {
  return async (req: Request, res: Response) => {
    const codigo = String(req.params.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const r = await pool.query(
      `UPDATE smart_links SET cliques = cliques + 1, ultimo_clique_em = NOW()
       WHERE codigo = $1 AND ativo = true RETURNING numero, mensagem, codigo`,
      [codigo]
    ).catch(() => ({ rows: [] as any[] }));
    const link = r.rows[0];
    if (!link) return res.status(404).send('Link não encontrado ou desativado.');
    const url = `https://wa.me/${link.numero}?text=${encodeURIComponent(textoDoLink(link.mensagem, link.codigo))}`;
    return res.redirect(302, url);
  };
}

export default function smartLinksRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `SELECT s.*, a.nome AS agente_nome, a.evolution_instancia
       FROM smart_links s LEFT JOIN agentes a ON a.id = s.agente_id
       WHERE s.user_id = $1 ORDER BY s.criado_em DESC`,
      [req.userId]
    );
    return res.json(r.rows);
  });

  router.post('/', async (req: AuthRequest, res: Response) => {
    const { nome, agente_id, mensagem, origem, campanha } = req.body || {};
    if (!String(nome || '').trim()) return res.status(400).json({ message: 'Dê um nome ao link' });
    if (!agente_id) return res.status(400).json({ message: 'Escolha a instância (número) de destino' });
    const ag = await pool.query(
      `SELECT numero_conectado FROM agentes WHERE id = $1 AND user_id = $2`,
      [agente_id, req.userId]
    );
    const numero = String(ag.rows[0]?.numero_conectado || '').replace(/\D/g, '');
    if (!ag.rows.length) return res.status(404).json({ message: 'Instância não encontrada' });
    if (numero.length < 10) return res.status(409).json({ message: 'Essa instância ainda não tem número conectado' });
    const texto = String(mensagem || '').trim() || 'Olá! Quero saber mais.';
    for (let t = 0; t < 5; t++) {
      try {
        const r = await pool.query(
          `INSERT INTO smart_links (user_id, codigo, nome, agente_id, numero, mensagem, origem, campanha)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [req.userId, gerarCodigo(), String(nome).trim().slice(0, 120), agente_id, numero, texto.slice(0, 500),
           ORIGENS.includes(origem) ? origem : 'outro', String(campanha || '').trim().slice(0, 120) || null]
        );
        return res.status(201).json(r.rows[0]);
      } catch (err: any) {
        if (err?.code !== '23505') throw err; // colisão de código (raríssima) — tenta outro
      }
    }
    return res.status(500).json({ message: 'Não foi possível gerar um código único' });
  });

  router.patch('/:id', async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `UPDATE smart_links SET ativo = COALESCE($3, ativo) WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.userId, typeof req.body?.ativo === 'boolean' ? req.body.ativo : null]
    );
    if (!r.rows.length) return res.status(404).json({ message: 'Link não encontrado' });
    return res.json(r.rows[0]);
  });

  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    await pool.query(`DELETE FROM smart_links WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
    return res.status(204).send();
  });

  // KPI por instância (30 dias): conversas 1:1 iniciadas pelo cliente × pela empresa.
  router.get('/kpi', async (req: AuthRequest, res: Response) => {
    const r = await pool.query(
      `WITH primeira AS (
         SELECT DISTINCT ON (instance_name, remote_jid) instance_name, remote_jid, from_me
         FROM whatsapp_messages
         WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
           AND remote_jid NOT LIKE '%@g.us' AND remote_jid NOT LIKE '%@newsletter' AND remote_jid NOT LIKE '%@broadcast'
         ORDER BY instance_name, remote_jid, created_at ASC
       )
       SELECT instance_name AS instancia,
              COUNT(*) FILTER (WHERE NOT from_me)::int AS inbound,
              COUNT(*) FILTER (WHERE from_me)::int AS outbound
       FROM primeira GROUP BY instance_name ORDER BY instance_name`,
      [req.userId]
    );
    return res.json(r.rows.map((x: any) => ({
      ...x,
      pct_inbound: x.inbound + x.outbound > 0 ? Math.round((x.inbound / (x.inbound + x.outbound)) * 100) : null,
    })));
  });

  return router;
}
