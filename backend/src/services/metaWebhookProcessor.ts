/**
 * metaWebhookProcessor.ts — processamento completo do webhook da API oficial (Meta Cloud API),
 * Sprint 5 H1/H2/H4 + Sprint 3 H5 (2026-10-05).
 *
 * [AUDITORIA] LÓGICA: o canal oficial do CRM é a integração DIRETA com a Meta (decisão do
 * usuário), não a Evolution — então as lacunas da Evolution no modo WHATSAPP-BUSINESS (L1-L4 do
 * relatório) não se aplicam: este webhook recebe tudo da Meta e itera TODOS os entry[]/changes[].
 * Até aqui ele só gravava as mensagens recebidas; o resto ia pro log. Agora cada mudança:
 *   1. entra em `meta_webhook_inbox` (idempotente por config + campo + id do evento — a Meta
 *      reenvia o mesmo evento quando não recebe 200 a tempo);
 *   2. é tratada pelo campo:
 *      - messages: grava a mensagem, cria/atualiza o contato, abre a janela de atendimento
 *        (24h; 72h quando vem de anúncio clique-para-WhatsApp), registra opt-in quando o contato
 *        iniciou a conversa, identidades (wa_id/BSUID) e opt-out por palavra-chave;
 *      - statuses: último status por mensagem com código de erro e cobrança (pricing) e a ação
 *        do código (tabela `meta_erros_acao`);
 *      - account_update / phone_number_quality_update: estado da conta, qualidade e limite;
 *      - message_template_status_update / template_category_update: status/categoria do template;
 *      - user_preferences: "Parar promoções" → opt-out de marketing;
 *      - smb_message_echoes (coexistência): mensagem enviada pelo app do celular vira mensagem
 *        "enviada" na conversa do CRM; history / smb_app_state_sync ficam guardados no inbox.
 */
import { Pool } from 'pg';
import crypto from 'crypto';
import { withTenantContext } from '../db';
import { log } from '../logger';
import { registrarEvento } from './saudeNumero';

const PALAVRAS_OPTOUT = /^\s*(sair|parar|pare|stop|cancelar|remover|n[aã]o quero( mais)?|parar promo[cç][oõ]es|descadastrar)\s*[.!]*\s*$/i;
const digitos = (s: unknown) => String(s || '').replace(/\D/g, '');

export interface ResultadoProcessamento { processados: number; duplicados: number; erros: number }

/** Processa um POST já com assinatura validada. Nunca lança. */
export async function processarWebhookMeta(pool: Pool, cfg: any, body: any): Promise<ResultadoProcessamento> {
  const res: ResultadoProcessamento = { processados: 0, duplicados: 0, erros: 0 };
  for (const entrada of body?.entry || []) {
    for (const mudanca of entrada?.changes || []) {
      const campo = String(mudanca?.field || 'desconhecido');
      const valor = mudanca?.value || {};
      // messages/statuses podem vir vários no mesmo change — cada item vira um evento.
      const itens: { id: string; tipo: string; dado: any }[] = [];
      if (campo === 'messages') {
        for (const m of valor.messages || []) itens.push({ id: String(m.id), tipo: 'message', dado: m });
        for (const s of valor.statuses || []) itens.push({ id: `${s.id}:${s.status}`, tipo: 'status', dado: s });
        if (!itens.length) itens.push({ id: hash(valor, entrada?.time), tipo: 'outro', dado: valor });
      } else {
        itens.push({ id: hash(valor, entrada?.time), tipo: 'campo', dado: valor });
      }
      for (const item of itens) {
        const ins = await pool.query(
          `INSERT INTO meta_webhook_inbox (config_id, user_id, waba_id, campo, evento_id, payload)
           VALUES ($1, $2, $6, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
          [cfg.id, cfg.user_id, item.tipo === 'status' ? 'statuses' : campo, item.id,
           JSON.stringify({ entry_id: entrada?.id, value: valor, item: item.dado }), entrada?.id || cfg.waba_id || null]
        // Erro de banco no inbox (≠ duplicado) não pode descartar o evento: processa sem idempotência.
        ).catch(err => { log.warn('META_WEBHOOK', 'Falha ao gravar no inbox — processando assim mesmo', { err: err?.message }); return null; });
        if (ins && !ins.rows.length) { res.duplicados++; continue; }
        const inboxId: number | null = ins?.rows[0]?.id ?? null;
        try {
          if (item.tipo === 'message') await tratarMensagem(pool, cfg, item.dado, valor);
          else if (item.tipo === 'status') await tratarStatus(pool, cfg, item.dado);
          else await tratarCampo(pool, cfg, campo, valor);
          if (inboxId) await pool.query(`UPDATE meta_webhook_inbox SET processado_em = NOW() WHERE id = $1`, [inboxId]).catch(() => {});
          res.processados++;
        } catch (err: any) {
          res.erros++;
          if (inboxId) await pool.query(`UPDATE meta_webhook_inbox SET erro = $2 WHERE id = $1`, [inboxId, String(err?.message || err).slice(0, 500)]).catch(() => {});
          log.warn('META_WEBHOOK', 'Falha ao tratar evento', { campo, err: err?.message });
        }
      }
    }
  }
  return res;
}

function hash(valor: unknown, tempo: unknown): string {
  return crypto.createHash('sha1').update(JSON.stringify(valor) + String(tempo ?? '')).digest('hex');
}

// ── messages ────────────────────────────────────────────────────────────────────────────────
async function tratarMensagem(pool: Pool, cfg: any, msg: any, valor: any): Promise<void> {
  const contato0 = (valor.contacts || [])[0] || {};
  const telefone = digitos(contato0.wa_id || msg.from);
  const bsuid: string | null = contato0.user_id || msg.from_user_id || null;
  const tipo: string = msg.type || 'text';
  const texto: string | null = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || null;
  const pushName: string | null = contato0.profile?.name || null;
  const instanceName = `meta_oficial:${cfg.phone_number_id}`;
  const ts = Number(msg.timestamp) || Math.floor(Date.now() / 1000);
  const remoteJid = telefone ? `${telefone}@s.whatsapp.net` : `${bsuid}@bsuid`;

  await withTenantContext({ userId: cfg.user_id, isAdmin: false }, client => client.query(
    `INSERT INTO whatsapp_messages
       (user_id, instance_name, remote_jid, message_id, from_me, message_type, content, status, timestamp_wa, push_name)
     VALUES ($1,$2,$3,$4,false,$5,$6,'received',to_timestamp($7),$8)
     ON CONFLICT (message_id, instance_name) DO NOTHING`,
    [cfg.user_id, instanceName, remoteJid, msg.id, tipo, texto, ts, pushName]
  ));

  if (!telefone) {
    // 2026: a Meta pode mandar só o BSUID (sem telefone). Guarda a identidade; contato sem telefone
    // só responde dentro da conversa (Sprint 3 / H1).
    if (bsuid) {
      await pool.query(
        `INSERT INTO contato_identidades (user_id, tipo, valor, waba_id) VALUES ($1, 'bsuid', $2, $3)
         ON CONFLICT (user_id, tipo, valor) DO UPDATE SET atualizado_em = NOW()`,
        [cfg.user_id, bsuid, cfg.waba_id]
      ).catch(() => {});
    }
    return;
  }

  const anuncio = msg.referral || null; // clique-para-WhatsApp (CTWA): abre 72h grátis
  const janelaHoras = anuncio ? 72 : 24;
  const c = await pool.query(
    `INSERT INTO contatos (user_id, nome, telefone, push_name, origem, status, ultima_mensagem_em, atendente_pausou_ia,
                           optin_origem, optin_em, optin_prova, janela_oficial_ate)
     VALUES ($1, $2, $3, $2, 'WhatsApp Oficial', 'novo', NOW(), false, $4, NOW(), $5, NOW() + ($6 || ' hours')::interval)
     ON CONFLICT (user_id, telefone) WHERE telefone IS NOT NULL DO UPDATE SET
       push_name = COALESCE(EXCLUDED.push_name, contatos.push_name),
       ultima_mensagem_em = NOW(),
       janela_oficial_ate = GREATEST(COALESCE(contatos.janela_oficial_ate, NOW()), EXCLUDED.janela_oficial_ate),
       optin_origem = COALESCE(contatos.optin_origem, EXCLUDED.optin_origem),
       optin_em = COALESCE(contatos.optin_em, EXCLUDED.optin_em),
       optin_prova = COALESCE(contatos.optin_prova, EXCLUDED.optin_prova)
     RETURNING id`,
    [cfg.user_id, pushName || telefone, telefone,
     anuncio ? 'anuncio_ctwa' : 'conversa_iniciada_pelo_contato',
     anuncio ? `anúncio: ${String(anuncio.headline || anuncio.source_id || '').slice(0, 150)}` : `mensagem ${msg.id}`,
     String(janelaHoras)]
  );
  const contatoId = c.rows[0]?.id;

  if (anuncio && contatoId) {
    await pool.query(
      `UPDATE contatos SET origem_inbound_em = COALESCE(origem_inbound_em, NOW()), origem_inbound_tipo = COALESCE(origem_inbound_tipo, 'anuncio'),
              origem_inbound_campanha = COALESCE(origem_inbound_campanha, $2) WHERE id = $1`,
      [contatoId, String(anuncio.headline || anuncio.source_id || 'Anúncio clique-para-WhatsApp').slice(0, 200)]
    ).catch(() => {});
  }
  for (const [t, v] of [['wa_id', telefone], ['bsuid', bsuid], ['username', contato0.username || null]] as const) {
    if (!v || !contatoId) continue;
    await pool.query(
      `INSERT INTO contato_identidades (user_id, tipo, valor, contato_id, waba_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, tipo, valor) DO UPDATE SET contato_id = EXCLUDED.contato_id, atualizado_em = NOW()`,
      [cfg.user_id, t, v, contatoId, cfg.waba_id]
    ).catch(() => {});
  }
  if (texto && PALAVRAS_OPTOUT.test(texto)) {
    await pool.query(`UPDATE contatos SET opt_out = true, marketing_optout_em = COALESCE(marketing_optout_em, NOW()) WHERE id = $1`, [contatoId]).catch(() => {});
    await pool.query(`INSERT INTO disparo_optouts (user_id, telefone, motivo) VALUES ($1, $2, $3)`, [cfg.user_id, telefone, `API oficial: ${texto.slice(0, 60)}`]).catch(() => {});
  }
}

// ── statuses ────────────────────────────────────────────────────────────────────────────────
export async function tratarStatus(pool: Pool, cfg: any, s: any): Promise<void> {
  const erro = (s.errors || [])[0] || null;
  const codigo: number | null = erro?.code != null ? Number(erro.code) : null;
  const destinatario = digitos(s.recipient_id);
  await pool.query(
    `INSERT INTO meta_mensagens_status (message_id, config_id, user_id, destinatario, status, erro_codigo, erro_titulo,
                                        pricing_categoria, pricing_cobravel, pricing_modelo, conversa_id, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (message_id) DO UPDATE SET
       status = EXCLUDED.status, erro_codigo = COALESCE(EXCLUDED.erro_codigo, meta_mensagens_status.erro_codigo),
       erro_titulo = COALESCE(EXCLUDED.erro_titulo, meta_mensagens_status.erro_titulo),
       pricing_categoria = COALESCE(EXCLUDED.pricing_categoria, meta_mensagens_status.pricing_categoria),
       pricing_cobravel = COALESCE(EXCLUDED.pricing_cobravel, meta_mensagens_status.pricing_cobravel),
       pricing_modelo = COALESCE(EXCLUDED.pricing_modelo, meta_mensagens_status.pricing_modelo),
       conversa_id = COALESCE(EXCLUDED.conversa_id, meta_mensagens_status.conversa_id), atualizado_em = NOW()`,
    [s.id, cfg.id, cfg.user_id, destinatario, s.status, codigo, erro?.title || erro?.message || null,
     s.pricing?.category || null, s.pricing?.billable ?? null, s.pricing?.pricing_model || null, s.conversation?.id || null]
  );
  // Status também alimenta as métricas de campanha (Sprint 4 / H3) quando o envio veio de lá.
  if (['delivered', 'read'].includes(s.status)) {
    await pool.query(
      `UPDATE disparo_logs SET entregue_em = COALESCE(entregue_em, NOW()),
              lido_em = CASE WHEN $2 THEN COALESCE(lido_em, NOW()) ELSE lido_em END
       WHERE message_id = $1`,
      [s.id, s.status === 'read']
    ).catch(() => {});
  }
  // Sprint 6 / H5: a Meta aceita o envio (200 + wamid) e só depois avisa a falha por webhook —
  // a linha da campanha passa de 'sent' pra 'failed' (uma vez só) com o código da Meta.
  if (s.status === 'failed') {
    const f = await pool.query(
      `UPDATE disparo_logs SET status = 'failed', erro = $2, tipo_falha = $3
       WHERE message_id = $1 AND status = 'sent' RETURNING disparo_id`,
      [s.id, `Meta ${codigo ?? ''}: ${erro?.title || erro?.message || 'falha na entrega'}`.slice(0, 500),
       codigo === 131026 ? 'numero_invalido' : codigo === 131049 ? 'saturado' : codigo === 131050 ? 'optout' : 'erro_desconhecido']
    ).catch(() => ({ rows: [] as any[] }));
    if (f.rows[0]?.disparo_id) {
      await pool.query(`UPDATE disparos SET falhas = falhas + 1, enviados = GREATEST(enviados - 1, 0) WHERE id = $1`, [f.rows[0].disparo_id]).catch(() => {});
    }
  }
  if (codigo === null || !destinatario) return;

  const acao = (await pool.query(`SELECT acao FROM meta_erros_acao WHERE codigo = $1`, [codigo]).catch(() => ({ rows: [] as any[] }))).rows[0]?.acao;
  const doContato = `user_id = $1 AND RIGHT(regexp_replace(telefone, '\\D', '', 'g'), 11) = RIGHT($2, 11)`;
  switch (acao) {
    case 'saturar':
      // 131049: 1ª vez segura 24h; repetindo dentro de 7 dias, satura por 7 dias.
      await pool.query(
        `UPDATE contatos SET meta_saturado_ate = CASE WHEN meta_saturado_ate > NOW() - INTERVAL '7 days'
                                                      THEN NOW() + INTERVAL '7 days' ELSE NOW() + INTERVAL '24 hours' END
         WHERE ${doContato}`, [cfg.user_id, destinatario]).catch(() => {});
      break;
    case 'invalido_apos_2':
      await pool.query(
        `UPDATE contatos SET meta_falhas_131026 = COALESCE(meta_falhas_131026, 0) + 1,
                whatsapp_status = CASE WHEN COALESCE(meta_falhas_131026, 0) + 1 >= 2 THEN 'sem_whatsapp' ELSE whatsapp_status END
         WHERE ${doContato}`, [cfg.user_id, destinatario]).catch(() => {});
      break;
    case 'optout_marketing':
      await pool.query(`UPDATE contatos SET marketing_optout_em = COALESCE(marketing_optout_em, NOW()) WHERE ${doContato}`, [cfg.user_id, destinatario]).catch(() => {});
      break;
    case 'risco_pausar':
      await registrarEvento(pool, null, `meta_oficial:${cfg.phone_number_id}`, 'risco_meta', codigo, { titulo: erro?.title });
      await pool.query(
        `UPDATE whatsapp_oficial_config SET alerta = $2, alerta_em = NOW() WHERE id = $1`,
        [cfg.id, `A Meta sinalizou spam (${codigo}): muitas mensagens bloqueadas ou denunciadas. Pause o marketing e revise a lista.`]
      ).catch(() => {});
      await pausarCampanhasOficiais(pool, cfg.id, `A Meta sinalizou spam (erro ${codigo}). Revise a lista antes de retomar.`);
      break;
    default:
      break; // exige_template / espacar_contato / backoff: registrados no status; usados pelo envio oficial
  }
}

// ── demais campos ───────────────────────────────────────────────────────────────────────────
async function tratarCampo(pool: Pool, cfg: any, campo: string, v: any): Promise<void> {
  const instancia = `meta_oficial:${cfg.phone_number_id}`;
  switch (campo) {
    case 'account_update': {
      const evento = String(v.event || 'desconhecido');
      await registrarEvento(pool, null, instancia, 'conta_meta', null, { evento, detalhe: v.ban_info || v.violation_info || v.restriction_info || null });
      const grave = /RESTRICT|DISABLE|BAN|VIOLATION|FLAG/i.test(evento);
      await pool.query(
        `UPDATE whatsapp_oficial_config SET conta_status = $2,
                alerta = CASE WHEN $3 THEN $4 ELSE alerta END, alerta_em = CASE WHEN $3 THEN NOW() ELSE alerta_em END
         WHERE id = $1`,
        [cfg.id, evento, grave, `A Meta informou: ${evento}. Verifique a conta no Gerenciador do WhatsApp antes de enviar marketing.`]
      );
      if (grave) await pausarCampanhasOficiais(pool, cfg.id, `A Meta informou "${evento}" na conta. Verifique antes de retomar.`);
      break;
    }
    case 'phone_number_quality_update': {
      const limite = v.max_daily_conversations_per_business || v.current_limit || null;
      await pool.query(
        `UPDATE whatsapp_oficial_config SET max_conversas_dia = COALESCE($2, max_conversas_dia),
                messaging_limit_tier = COALESCE($2, messaging_limit_tier), qualidade_atualizada_em = NOW()
         WHERE id = $1`,
        [cfg.id, limite]
      );
      await registrarEvento(pool, null, instancia, 'limite_meta', null, { evento: v.event, limite, anterior: v.old_limit || null });
      break;
    }
    case 'message_template_status_update': {
      const motivo = v.reason && v.reason !== 'NONE' ? v.reason : null;
      const upd = await pool.query(
        `UPDATE meta_templates SET status = $3, motivo_rejeicao = $4, meta_id = COALESCE(meta_id, NULLIF($2, '')), atualizado_em = NOW()
         WHERE config_id = $1 AND (meta_id = $2 OR nome = $5)`,
        [cfg.id, String(v.message_template_id || ''), v.event || null, motivo, v.message_template_name || '']
      );
      if (!upd.rowCount && v.message_template_name) {
        // Template ainda não sincronizado: registra já com o status que a Meta mandou.
        await pool.query(
          `INSERT INTO meta_templates (config_id, user_id, meta_id, nome, idioma, status, motivo_rejeicao)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (config_id, nome, idioma) DO NOTHING`,
          [cfg.id, cfg.user_id, String(v.message_template_id || '') || null, v.message_template_name,
           v.message_template_language || 'pt_BR', v.event || null, motivo]
        );
      }
      if (/PAUSED|DISABLED/i.test(String(v.event || '')) && v.message_template_name) {
        await pausarCampanhasOficiais(pool, cfg.id,
          `O template "${v.message_template_name}" foi ${/PAUSED/i.test(v.event) ? 'pausado' : 'desativado'} pela Meta. Troque o template antes de retomar.`,
          v.message_template_name);
      }
      break;
    }
    case 'template_category_update':
      await pool.query(
        `UPDATE meta_templates SET categoria = COALESCE($3, categoria), atualizado_em = NOW()
         WHERE config_id = $1 AND (meta_id = $2 OR nome = $4)`,
        [cfg.id, String(v.message_template_id || ''), v.new_category || v.correct_category || null, v.message_template_name || '']
      );
      await registrarEvento(pool, null, instancia, 'template_recategorizado', null,
        { template: v.message_template_name, de: v.previous_category, para: v.new_category || v.correct_category });
      break;
    case 'user_preferences':
      for (const p of v.user_preferences || []) {
        const tel = digitos(p.wa_id);
        if (!tel || !/marketing/i.test(String(p.category || ''))) continue;
        const parar = /stop/i.test(String(p.value || ''));
        await pool.query(
          `UPDATE contatos SET marketing_optout_em = CASE WHEN $3 THEN COALESCE(marketing_optout_em, NOW()) ELSE NULL END
           WHERE user_id = $1 AND RIGHT(regexp_replace(telefone, '\\D', '', 'g'), 11) = RIGHT($2, 11)`,
          [cfg.user_id, tel, parar]
        );
      }
      break;
    case 'smb_message_echoes':
      // Coexistência: mensagem enviada pelo app do celular entra na conversa do CRM como enviada.
      for (const e of v.message_echoes || []) {
        const para = digitos(e.to);
        if (!para) continue;
        await withTenantContext({ userId: cfg.user_id, isAdmin: false }, client => client.query(
          `INSERT INTO whatsapp_messages (user_id, instance_name, remote_jid, message_id, from_me, message_type, content, status, timestamp_wa)
           VALUES ($1,$2,$3,$4,true,$5,$6,'sent',to_timestamp($7)) ON CONFLICT (message_id, instance_name) DO NOTHING`,
          [cfg.user_id, instancia, `${para}@s.whatsapp.net`, e.id, e.type || 'text', e.text?.body || null,
           Number(e.timestamp) || Math.floor(Date.now() / 1000)]
        ));
      }
      break;
    default:
      // history, smb_app_state_sync e campos futuros: ficam guardados em meta_webhook_inbox.
      break;
  }
}

/** Pausa campanhas oficiais em andamento deste número (todas, ou só as que usam `templateNome`). */
async function pausarCampanhasOficiais(pool: Pool, configId: string, aviso: string, templateNome?: string): Promise<void> {
  const r = await pool.query(
    `UPDATE disparos SET status = 'pausado', pausado_em = NOW(), pausado_motivo = 'meta_oficial', aviso = $2, updated_at = NOW()
     WHERE canal = 'oficial' AND oficial_config_id = $1 AND status IN ('em_andamento','agendado')
       AND ($3::text IS NULL OR meta_template_nome = $3)
     RETURNING id`,
    [configId, aviso, templateNome ?? null]
  ).catch(() => ({ rows: [] as any[] }));
  if (r.rows.length) log.warn('META_WEBHOOK', 'Campanhas oficiais pausadas', { configId, total: r.rows.length, aviso });
}
