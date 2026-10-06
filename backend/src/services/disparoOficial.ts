/**
 * disparoOficial.ts — campanha pelo canal oficial (Meta Cloud API), Sprint 6 / H5 (2026-10-05).
 *
 * [AUDITORIA] LÓGICA: o mesmo motor de fila de `disparoProcessor.ts` (get_next_disparo_batch,
 * cron de 2s) atende as campanhas com `disparos.canal = 'oficial'`, mas o envio desvia pra cá:
 *   - só template APROVADO da WABA (texto livre fora da janela de 24h é bloqueado pela própria
 *     Meta — erro 131047 — e o CRM nem tenta);
 *   - só contato com opt-in registrado (`contatos.optin_origem`), sem opt-out de marketing, não
 *     saturado (131049) e com WhatsApp (131026 2x marca sem WhatsApp). Contato minerado em grupo
 *     sem opt-in fica de fora até iniciar conversa (política da Meta: consentimento antes de
 *     mensagem proativa — disparar pra lead frio derruba a qualidade do portfólio inteiro);
 *   - qualidade Vermelha pausa Marketing; Amarela corta o limite de Marketing à metade;
 *   - limite diário do PORTFÓLIO (contatos únicos/24h somando todos os números da WABA);
 *   - a fila é montada no SERVIDOR (`criarCampanhaOficial`), com as regras acima — não dá pra
 *     burlar pelo navegador.
 */
import { Pool } from 'pg';
import { log } from '../logger';
import { graphFetch, parseLimiteMensagens } from './metaCloudApi';
import { avaliarElegibilidade } from '../utils/elegibilidade';

export type MotivoBloqueioOficial =
  | 'sem_optin' | 'optout_marketing' | 'saturado' | 'sem_whatsapp' | 'opt_out' | 'sem_telefone' | 'lid_ou_grupo';

export const ROTULO_BLOQUEIO_OFICIAL: Record<MotivoBloqueioOficial, string> = {
  sem_optin: 'sem consentimento (opt-in) registrado',
  optout_marketing: 'pediu para não receber marketing',
  saturado: 'saturado de marketing (Meta segurou mensagens, erro 131049)',
  sem_whatsapp: 'sem WhatsApp',
  opt_out: 'pediu para não ser contatado',
  sem_telefone: 'sem telefone',
  lid_ou_grupo: 'número oculto (LID) ou grupo',
};

export function avaliarContatoOficial(c: any, categoria: string): MotivoBloqueioOficial | null {
  const base = avaliarElegibilidade({ ...c, propensao: null }, { excluirRobos: false, excluirSemNome: false });
  if (base === 'sem_telefone') return 'sem_telefone';
  if (base === 'grupo_ou_lid' || base === 'telefone_invalido') return 'lid_ou_grupo';
  if (base === 'sem_whatsapp') return 'sem_whatsapp';
  if (c.opt_out === true) return 'opt_out';
  if (!c.optin_origem) return 'sem_optin';
  if (String(categoria).toUpperCase() === 'MARKETING') {
    if (c.marketing_optout_em) return 'optout_marketing';
    if (c.meta_saturado_ate && new Date(c.meta_saturado_ate) > new Date()) return 'saturado';
  }
  return null;
}

// Campos do contato que podem preencher {{1}}, {{2}}… (H4: mapeamento na hora do disparo).
export const CAMPOS_VARIAVEL = ['primeiro_nome', 'nome', 'empresa', 'cidade', 'estado', 'interesse'] as const;
function valorVariavel(c: any, campo: string, fallback: string): string {
  const v = campo === 'primeiro_nome'
    ? (c.primeiro_nome || String(c.nome || '').trim().split(/\s+/)[0])
    : c[campo];
  const s = String(v || '').trim();
  return s && !/^[0-9+() -]+$/.test(s) ? s : fallback;
}

async function precoCategoria(pool: Pool, categoria: string): Promise<number | null> {
  const r = await pool.query(`SELECT preco_usd FROM precos_meta WHERE pais = 'BR' AND categoria = $1`, [String(categoria).toLowerCase()]).catch(() => ({ rows: [] as any[] }));
  const v = r.rows[0]?.preco_usd;
  return v === null || v === undefined ? null : Number(v);
}

/**
 * Avalia a audiência (e, com `criar`, cria a campanha + fila). Custo estimado = cobráveis × preço
 * da categoria, descontando quem está na janela grátis: Free Entry Point de 72h dos anúncios CTWA
 * (marketing e utilidade) e, pra Utilidade, a janela de atendimento de 24h aberta.
 */
export async function avaliarOuCriarCampanhaOficial(pool: Pool, userId: string, cfg: any, body: any, criar: boolean) {
  const tpl = (await pool.query(
    `SELECT nome, idioma, categoria, status FROM meta_templates WHERE config_id = $1 AND nome = $2 AND idioma = $3`,
    [cfg.id, body.template_nome, body.idioma || 'pt_BR']
  )).rows[0];
  if (!tpl) return { erro: 'Template não encontrado — sincronize os templates da Meta.' };
  if (tpl.status !== 'APPROVED') return { erro: `O template "${tpl.nome}" não está aprovado pela Meta (status: ${tpl.status || 'desconhecido'}).` };
  if (String(tpl.categoria).toUpperCase() === 'MARKETING' && String(cfg.quality_rating || '').toUpperCase() === 'RED') {
    return { erro: 'Qualidade do número está Vermelha — a Meta restringe marketing. Envie só Utilidade até a qualidade melhorar.' };
  }
  let ids: string[] = Array.isArray(body.contato_ids) ? body.contato_ids : [];
  // Audiência por lista/etiqueta (ou todos com opt-in), resolvida no servidor.
  if (!ids.length && (body.lista_id || body.tag || body.todos_com_optin)) {
    const r = await pool.query(
      `SELECT id FROM contatos WHERE user_id = $1
         AND ($2::uuid IS NULL OR lista_id = $2::uuid)
         AND ($3::text IS NULL OR $3 = ANY(tags))
         AND (NOT $4 OR optin_origem IS NOT NULL)
       LIMIT 20000`,
      [userId, body.lista_id || null, body.tag || null, !!body.todos_com_optin]
    );
    ids = r.rows.map((x: any) => x.id);
  }
  if (!ids.length) return { erro: 'Nenhum contato na audiência escolhida.' };

  const contatos = (await pool.query(
    `SELECT id, nome, primeiro_nome, telefone, telefone_normalizado, tipo_telefone, whatsapp_status, opt_out, bot_detectado,
            resposta_categoria, resposta_em, ultimo_disparo_em, nome_confiavel, empresa, cidade, estado, interesse,
            optin_origem, marketing_optout_em, meta_saturado_ate, janela_oficial_ate, origem_inbound_tipo, origem_inbound_em
     FROM contatos WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, ids]
  )).rows;
  const bloqueados: Partial<Record<MotivoBloqueioOficial, number>> = {};
  const elegiveis: any[] = [];
  for (const c of contatos) {
    const m = avaliarContatoOficial(c, tpl.categoria);
    if (m) bloqueados[m] = (bloqueados[m] ?? 0) + 1; else elegiveis.push(c);
  }
  const agora = Date.now();
  const emFep = elegiveis.filter(c => c.origem_inbound_tipo === 'anuncio' && c.origem_inbound_em
    && agora - new Date(c.origem_inbound_em).getTime() < 72 * 3_600_000).length;
  const emJanela = elegiveis.filter(c => c.janela_oficial_ate && new Date(c.janela_oficial_ate).getTime() > agora).length;
  const cat = String(tpl.categoria).toLowerCase();
  const gratis = cat === 'utility' ? Math.max(emFep, emJanela) : emFep;
  const cobraveis = Math.max(0, elegiveis.length - gratis);
  const preco = await precoCategoria(pool, cat);
  const custo = preco === null ? null : Number((cobraveis * preco).toFixed(4));
  const resumo = {
    template: tpl, selecionados: contatos.length, elegiveis: elegiveis.length, bloqueados,
    rotulos: ROTULO_BLOQUEIO_OFICIAL, gratis, cobraveis, preco_unitario_usd: preco, custo_estimado_usd: custo,
    pct_optin: contatos.length ? Math.round((contatos.filter(c => c.optin_origem).length / contatos.length) * 100) : 0,
  };
  if (!criar) return resumo;
  if (!elegiveis.length) return { ...resumo, erro: 'Nenhum contato elegível para o canal oficial.' };

  const d = await pool.query(
    `INSERT INTO disparos (user_id, nome, status, canal, oficial_config_id, meta_template_nome, meta_template_idioma,
                           meta_template_categoria, meta_variaveis, total_leads, custo_estimado_usd, mensagem_template)
     VALUES ($1,$2,'em_andamento','oficial',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [userId, String(body.nome || `Oficial — ${tpl.nome}`).slice(0, 200), cfg.id, tpl.nome, tpl.idioma, tpl.categoria,
     JSON.stringify(body.variaveis || {}), elegiveis.length, custo, `[template Meta] ${tpl.nome}`]
  );
  const disparoId = d.rows[0].id;
  for (let i = 0; i < elegiveis.length; i += 500) {
    const lote = elegiveis.slice(i, i + 500);
    const vals: any[] = [];
    const linhas = lote.map((c, k) => {
      vals.push(disparoId, userId, c.id, String(c.telefone).replace(/\D/g, ''), c.nome || null);
      const b = k * 5;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},'pending')`;
    });
    await pool.query(`INSERT INTO disparo_logs (disparo_id, user_id, contato_id, telefone, nome, status) VALUES ${linhas.join(',')}`, vals);
  }
  log.info('DISPARO_OFICIAL', 'Campanha oficial criada', { disparoId, elegiveis: elegiveis.length, template: tpl.nome });
  return { ...resumo, disparo_id: disparoId };
}

/** Envio de UMA mensagem de campanha oficial (chamado pelo processador da fila). Nunca lança. */
export async function processarEnvioOficial(pool: Pool, msg: any, camp: any): Promise<void> {
  const { log_id, disparo_id, user_id, telefone } = msg;
  const falhar = (erro: string, tipo: string) => pool.query(
    `UPDATE disparo_logs SET status = 'failed', erro = $2, tipo_falha = $3 WHERE id = $1`, [log_id, erro, tipo]
  ).catch(() => {});
  const pausar = (aviso: string, motivo = 'meta_oficial') => pool.query(
    `UPDATE disparos SET status = 'pausado', pausado_em = NOW(), pausado_motivo = $3, aviso = $2, updated_at = NOW() WHERE id = $1`,
    [disparo_id, aviso, motivo]
  ).then(() => pool.query(`UPDATE disparo_logs SET status = 'pending' WHERE id = $1`, [log_id])).catch(() => {});

  const cfg = (await pool.query(`SELECT * FROM whatsapp_oficial_config WHERE id = $1`, [camp.oficial_config_id])).rows[0];
  if (!cfg || !cfg.ativo) { await pausar('O número oficial desta campanha está desativado ou foi removido.'); return; }
  const tpl = (await pool.query(
    `SELECT status, categoria FROM meta_templates WHERE config_id = $1 AND nome = $2 AND idioma = $3`,
    [cfg.id, camp.meta_template_nome, camp.meta_template_idioma || 'pt_BR']
  )).rows[0];
  if (!tpl || tpl.status !== 'APPROVED') { await pausar(`O template "${camp.meta_template_nome}" não está mais aprovado (${tpl?.status || 'removido'}).`); return; }
  const marketing = String(tpl.categoria).toUpperCase() === 'MARKETING';
  const qualidade = String(cfg.quality_rating || '').toUpperCase();
  if (marketing && qualidade === 'RED') { await pausar('Qualidade do número Vermelha: marketing pausado até a qualidade melhorar.'); return; }

  // Limite diário do PORTFÓLIO (contatos únicos/24h de todos os números da WABA).
  const { valor: limite } = parseLimiteMensagens(cfg.max_conversas_dia || cfg.messaging_limit_tier);
  if (limite) {
    const usoR = await pool.query(
      `SELECT COUNT(DISTINCT s.destinatario)::int AS n FROM meta_mensagens_status s JOIN whatsapp_oficial_config c ON c.id = s.config_id
       WHERE c.user_id = $1 AND c.waba_id = $2 AND s.criado_em >= NOW() - INTERVAL '24 hours'`,
      [cfg.user_id, cfg.waba_id]
    );
    const teto = marketing && qualidade === 'YELLOW' ? Math.floor(limite / 2) : limite;
    if ((usoR.rows[0]?.n ?? 0) >= teto) {
      await pausar(`Limite diário do portfólio atingido (${teto} contatos/24h${teto < limite ? ', reduzido à metade pela qualidade Amarela' : ''}). Retomando automaticamente amanhã.`, 'limite_diario');
      return;
    }
  }

  // Revalida o contato no envio (pode ter mudado desde a criação: opt-out, saturação, 131026).
  const c = (await pool.query(
    `SELECT * FROM contatos WHERE user_id = $1 AND RIGHT(regexp_replace(telefone, '\\D', '', 'g'), 11) = RIGHT($2, 11) ORDER BY created_at LIMIT 1`,
    [user_id, String(telefone).replace(/\D/g, '')]
  )).rows[0];
  const motivo = c ? avaliarContatoOficial(c, tpl.categoria) : 'sem_optin';
  if (motivo) { await falhar(`bloqueado_oficial:${motivo}`, 'bloqueado'); return; }

  const mapa: Record<string, string> = camp.meta_variaveis || {};
  const parametros = Object.keys(mapa).sort((a, b) => Number(a) - Number(b))
    .map(k => ({ type: 'text', text: valorVariavel(c, mapa[k], 'tudo bem') }));
  const r = await graphFetch(cfg, `${cfg.phone_number_id}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp', to: String(telefone).replace(/\D/g, ''), type: 'template',
      template: { name: camp.meta_template_nome, language: { code: camp.meta_template_idioma || 'pt_BR' },
                  ...(parametros.length ? { components: [{ type: 'body', parameters: parametros }] } : {}) },
    },
  });
  if (r.ok) {
    const wamid = r.data?.messages?.[0]?.id || null;
    await pool.query(
      `UPDATE disparo_logs SET status = 'sent', enviado_at = NOW(), message_id = $2, instancia = $3, tipo_falha = NULL WHERE id = $1`,
      [log_id, wamid, `meta_oficial:${cfg.phone_number_id}`]
    );
    await pool.query(`UPDATE disparos SET enviados = enviados + 1 WHERE id = $1`, [disparo_id]).catch(() => {});
    await pool.query(`UPDATE contatos SET ultimo_disparo_em = NOW() WHERE id = $1`, [c.id]).catch(() => {});
    if (wamid) {
      await pool.query(
        `INSERT INTO meta_mensagens_status (message_id, config_id, user_id, destinatario, status) VALUES ($1,$2,$3,$4,'accepted')
         ON CONFLICT (message_id) DO NOTHING`,
        [wamid, cfg.id, user_id, String(telefone).replace(/\D/g, '')]
      ).catch(() => {});
    }
    return;
  }
  const codigo = Number(r.data?.error?.code) || null;
  if (codigo === 130429) { // throughput: devolve pra fila (o delay da campanha faz o backoff)
    await pool.query(`UPDATE disparo_logs SET status = 'pending', tentativas = tentativas + 1 WHERE id = $1`, [log_id]).catch(() => {});
    return;
  }
  if (codigo === 131048) { await pausar('A Meta limitou o envio por spam (131048). Revise a lista antes de retomar.'); return; }
  await falhar(`Meta ${codigo ?? ''}: ${r.erro || 'falha no envio'}`, codigo === 131026 ? 'numero_invalido' : 'erro_desconhecido');
  await pool.query(`UPDATE disparos SET falhas = falhas + 1 WHERE id = $1`, [disparo_id]).catch(() => {});
}
