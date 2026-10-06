import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { avaliarContatoOficial } from '../src/services/disparoOficial';
import { validarTemplate } from '../src/routes/metaOficial';
import { verificarAssinaturaWebhook } from '../src/services/metaCloudApi';
import { processarWebhookMeta } from '../src/services/metaWebhookProcessor';

// Sprint 6 (2026-10-05): API Oficial — regras do envio oficial (H5), validação de template (H4) e
// processamento do webhook (H1) com payloads simulados (ainda sem WABA de teste).

/** Pool falso: o inbox é idempotente por (campo, evento_id); o resto devolve vazio. */
function poolFalso() {
  const vistos = new Set<string>();
  const sqls: string[] = [];
  return {
    sqls,
    query: async (sql: string, params: any[] = []) => {
      sqls.push(sql);
      if (sql.includes('INSERT INTO meta_webhook_inbox')) {
        const k = `${params[2]}|${params[3]}`;
        if (vistos.has(k)) return { rows: [] };
        vistos.add(k);
        return { rows: [{ id: vistos.size }] };
      }
      return { rows: [], rowCount: 0 };
    },
  } as any;
}

const contatoBase = {
  id: 'c1', telefone: '5511999998888', telefone_normalizado: '5511999998888', tipo_telefone: 'celular',
  whatsapp_status: null, opt_out: false, bot_detectado: false, resposta_categoria: null, resposta_em: null,
  ultimo_disparo_em: null, nome_confiavel: true, optin_origem: 'conversa_iniciada_pelo_contato',
  marketing_optout_em: null, meta_saturado_ate: null,
};

describe('avaliarContatoOficial (H5)', () => {
  it('contato com opt-in passa', () => {
    expect(avaliarContatoOficial(contatoBase, 'MARKETING')).toBeNull();
  });
  it('sem opt-in (ex.: minerado em grupo) é bloqueado', () => {
    expect(avaliarContatoOficial({ ...contatoBase, optin_origem: null }, 'MARKETING')).toBe('sem_optin');
  });
  it('opt-out de marketing bloqueia Marketing mas não Utilidade', () => {
    const c = { ...contatoBase, marketing_optout_em: new Date() };
    expect(avaliarContatoOficial(c, 'MARKETING')).toBe('optout_marketing');
    expect(avaliarContatoOficial(c, 'UTILITY')).toBeNull();
  });
  it('saturado (131049) só enquanto o prazo não venceu', () => {
    expect(avaliarContatoOficial({ ...contatoBase, meta_saturado_ate: new Date(Date.now() + 3_600_000) }, 'MARKETING')).toBe('saturado');
    expect(avaliarContatoOficial({ ...contatoBase, meta_saturado_ate: new Date(Date.now() - 3_600_000) }, 'MARKETING')).toBeNull();
  });
  it('sem WhatsApp, LID e opt-out geral bloqueiam', () => {
    expect(avaliarContatoOficial({ ...contatoBase, whatsapp_status: 'sem_whatsapp' }, 'UTILITY')).toBe('sem_whatsapp');
    expect(avaliarContatoOficial({ ...contatoBase, tipo_telefone: 'lid' }, 'UTILITY')).toBe('lid_ou_grupo');
    expect(avaliarContatoOficial({ ...contatoBase, opt_out: true }, 'UTILITY')).toBe('opt_out');
  });
});

describe('validarTemplate (H4)', () => {
  it('exige variáveis em sequência e exemplo para cada uma', () => {
    expect(validarTemplate({ nome: 'x', categoria: 'MARKETING', corpo: 'Oi {{1}} e {{3}}' }).erro).toMatch(/sequência/);
    expect(validarTemplate({ nome: 'x', categoria: 'MARKETING', corpo: 'Oi {{1}}', exemplos: [] }).erro).toMatch(/exemplo/);
  });
  it('rejeita nome com maiúscula/espaço', () => {
    expect(validarTemplate({ nome: 'Boas Vindas', categoria: 'UTILITY', corpo: 'Oi' }).erro).toBeTruthy();
  });
  it('Marketing ganha botão "Parar promoções" automático', () => {
    const v = validarTemplate({ nome: 'promo_out', categoria: 'MARKETING', corpo: 'Oi {{1}}', exemplos: ['Ana'] });
    const botoes = v.componentes!.find(c => c.type === 'BUTTONS');
    expect(botoes.buttons.map((b: any) => b.text)).toContain('Parar promoções');
  });
  it('texto promocional marcado como Utilidade gera aviso', () => {
    expect(validarTemplate({ nome: 'u', categoria: 'UTILITY', corpo: 'Aproveite 20% de desconto hoje' }).aviso).toBeTruthy();
    expect(validarTemplate({ nome: 'u', categoria: 'UTILITY', corpo: 'Seu pedido {{1}} saiu para entrega', exemplos: ['123'] }).aviso).toBeUndefined();
  });
});

describe('assinatura do webhook (H1)', () => {
  const segredo = 'segredo-de-teste';
  const corpo = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));
  const assinatura = 'sha256=' + crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
  it('aceita assinatura correta', () => {
    expect(verificarAssinaturaWebhook(segredo, corpo, assinatura)).toBe(true);
  });
  it('recusa assinatura errada ou ausente', () => {
    expect(verificarAssinaturaWebhook(segredo, corpo, 'sha256=' + '0'.repeat(64))).toBe(false);
    expect(verificarAssinaturaWebhook(segredo, corpo, undefined)).toBe(false);
  });
});

describe('processarWebhookMeta (H1)', () => {
  const cfg = { id: 'cfg1', user_id: 'u1', waba_id: 'waba1', phone_number_id: 'pn1' };
  const body = {
    object: 'whatsapp_business_account',
    entry: [
      { id: 'waba1', time: 1, changes: [
        { field: 'account_update', value: { event: 'VERIFIED_ACCOUNT' } },
        { field: 'phone_number_quality_update', value: { display_phone_number: '5511', event: 'FLAGGED', current_limit: 'TIER_1K' } },
      ] },
      { id: 'waba1', time: 2, changes: [
        { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'boas_vindas', message_template_language: 'pt_BR' } },
        { field: 'messages', value: { statuses: [{ id: 'wamid.A', status: 'delivered', recipient_id: '5511999998888' }] } },
      ] },
    ],
  };

  it('2 entries × 2 changes = 4 processamentos', async () => {
    const pool = poolFalso();
    const r = await processarWebhookMeta(pool, cfg, body);
    expect(r).toEqual({ processados: 4, duplicados: 0, erros: 0 });
  });

  it('o mesmo evento reenviado pela Meta é duplicado (não reprocessa)', async () => {
    const pool = poolFalso();
    await processarWebhookMeta(pool, cfg, body);
    const r2 = await processarWebhookMeta(pool, cfg, body);
    expect(r2).toEqual({ processados: 0, duplicados: 4, erros: 0 });
  });

  it('falha ao gravar o inbox não perde o evento', async () => {
    const pool = poolFalso();
    const original = pool.query;
    pool.query = async (sql: string, p: any[]) => {
      if (sql.includes('INSERT INTO meta_webhook_inbox')) throw new Error('db fora');
      return original(sql, p);
    };
    const r = await processarWebhookMeta(pool, cfg, body);
    expect(r.processados).toBe(4);
  });

  it('status failed marca a linha da campanha como falha', async () => {
    const pool = poolFalso();
    await processarWebhookMeta(pool, cfg, { entry: [{ id: 'waba1', changes: [{ field: 'messages', value: {
      statuses: [{ id: 'wamid.B', status: 'failed', recipient_id: '5511999998888', errors: [{ code: 131026, title: 'Message undeliverable' }] }],
    } }] }] });
    expect(pool.sqls.some((s: string) => s.includes("UPDATE disparo_logs SET status = 'failed'"))).toBe(true);
  });
});
