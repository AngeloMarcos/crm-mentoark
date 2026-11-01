/**
 * Sprint IA-1 (2026-10-29): comportamento de conversa configurável por agente (modelo Cubo).
 * Coluna NULL = comportamento de antes.
 */
import { describe, it, expect } from 'vitest';
import {
  esperaAgruparMs, limiteHistorico, cortarHistoricoPorTokens, dividirResposta,
  intervaloEntrePartesMs, instrucoesComportamento, formatarParte, mensagemDeErro,
  tempoDigitacaoMs, tempoLeituraMs, intervaloComVariacaoMs, comVariacao, normalizarParaRepeticao,
  digitacaoAtiva, marcarLidaAtivo, aplicarConfigDeTeste,
} from '../src/services/agenteConversa';

describe('aplicarConfigDeTeste (aba Teste usa o que está na tela)', () => {
  const doBanco = { id: 'a1', user_id: 'u1', prompt_sistema: 'antigo', modelo: 'gpt-4o-mini', evolution_api_key: 'k', ativo: true };
  it('sobrescreve só campos de comportamento da IA', () => {
    const r = aplicarConfigDeTeste(doBanco, {
      prompt_sistema: 'novo', modelo: 'gpt-5-nano',
      user_id: 'outro', evolution_api_key: 'roubada', ativo: false, id: 'x',
    });
    expect(r.prompt_sistema).toBe('novo');
    expect(r.modelo).toBe('gpt-5-nano');
    expect(r.user_id).toBe('u1');
    expect(r.evolution_api_key).toBe('k');
    expect(r.ativo).toBe(true);
    expect(r.id).toBe('a1');
  });
  it('sem config devolve o agente do banco', () => {
    expect(aplicarConfigDeTeste(doBanco, null)).toBe(doBanco);
  });
});

describe('conversa humana / anti-banimento (2026-10-31)', () => {
  const meio = () => 0.5; // sem variação
  it('digitando proporcional ao tamanho, com piso e teto', () => {
    expect(tempoDigitacaoMs('ok', {}, meio)).toBe(1500);                     // curto → piso 1,5 s
    expect(tempoDigitacaoMs('x'.repeat(130), {}, meio)).toBe(20_000 > 12_000 ? 12_000 : 20_000); // 130/6,5 = 20 s → teto 12 s
    expect(tempoDigitacaoMs('x'.repeat(39), {}, meio)).toBe(6000);           // 39/6,5 = 6 s
    expect(tempoDigitacaoMs('x'.repeat(39), { digitacao_velocidade: 'rapida' }, meio)).toBe(4333);
  });
  it('desligado volta ao 1,2 s fixo de antes', () => {
    expect(tempoDigitacaoMs('x'.repeat(200), { digitacao_ativa: false })).toBe(1200);
  });
  it('variação fica dentro de ±fração', () => {
    expect(comVariacao(1000, 0.25, () => 0)).toBe(750);
    expect(comVariacao(1000, 0.25, () => 1)).toBe(1250);
    expect(intervaloComVariacaoMs({ divisao_intervalo_ms: 0 })).toBe(0);
  });
  it('leitura entre 0,8 e 3 s', () => {
    expect(tempoLeituraMs(() => 0)).toBe(800);
    expect(tempoLeituraMs(() => 1)).toBe(3000);
  });
  it('padrões ligados; repetição ignora caixa, espaços e pontuação final', () => {
    expect(digitacaoAtiva({})).toBe(true);
    expect(marcarLidaAtivo({ marcar_lida: false })).toBe(false);
    expect(normalizarParaRepeticao('Olá,  tudo bem?!')).toBe(normalizarParaRepeticao('olá, tudo bem'));
  });
});

describe('padrões (tudo NULL = antes da sprint)', () => {
  it('espera 3 s, histórico 20, intervalo 3 s, sem instrução, sem mensagem de erro', () => {
    expect(esperaAgruparMs(null)).toBe(3000);
    expect(esperaAgruparMs({ tempo_espera_mensagem: 0 })).toBe(3000);
    expect(limiteHistorico({})).toBe(20);
    expect(intervaloEntrePartesMs({})).toBe(3000);
    expect(instrucoesComportamento({})).toBe('');
    expect(mensagemDeErro({ mensagem_erro: '  ' })).toBeNull();
  });

  it('divisão antiga: no máximo 2 partes, sem perder a 3ª do [QUEBRA]', () => {
    expect(dividirResposta('a[QUEBRA]b[QUEBRA]c', null)).toEqual(['a', 'b\n\nc']);
    expect(dividirResposta('p1\n\np2\n\np3', null)).toEqual(['p1\n\np2', 'p3']);
    expect(dividirResposta('só uma', null)).toEqual(['só uma']);
  });

  it('assinatura antiga: nome de exibição em negrito no topo', () => {
    expect(formatarParte('oi', null, 'Stella')).toBe('*Stella*\noi');
    expect(formatarParte('oi', null, '')).toBe('oi');
  });
});

describe('configurado', () => {
  it('espera em segundos, com teto de 60 s', () => {
    expect(esperaAgruparMs({ tempo_espera_mensagem: 10 })).toBe(10_000);
    expect(esperaAgruparMs({ tempo_espera_mensagem: 600 })).toBe(60_000);
  });

  it('histórico: limite de mensagens e corte das mais antigas por tokens', () => {
    expect(limiteHistorico({ historico_mensagens: 500 })).toBe(100);
    const h = [
      { role: 'user' as const, content: 'x'.repeat(400) },      // ~100 tokens
      { role: 'assistant' as const, content: 'y'.repeat(40) },  // ~10
      { role: 'user' as const, content: 'z'.repeat(40) },       // ~10
    ];
    expect(cortarHistoricoPorTokens(h, { historico_max_tokens: 50 }).map(m => m.role)).toEqual(['assistant', 'user']);
    expect(cortarHistoricoPorTokens(h, {})).toHaveLength(3);
  });

  it('divisão desligada junta tudo numa mensagem', () => {
    expect(dividirResposta('a[QUEBRA]b', { divisao_ativa: false })).toEqual(['a\n\nb']);
  });

  it('divisão por parágrafos agrupa N por mensagem', () => {
    const t = 'p1\n\np2\n\np3';
    expect(dividirResposta(t, { divisao_ativa: true, divisao_modo: 'paragrafos', divisao_tamanho: 1 })).toEqual(['p1', 'p2', 'p3']);
    expect(dividirResposta(t, { divisao_ativa: true, divisao_modo: 'paragrafos', divisao_tamanho: 2 })).toEqual(['p1\n\np2', 'p3']);
  });

  it('divisão por caracteres não parte palavra', () => {
    const partes = dividirResposta('um dois tres quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis', { divisao_ativa: true, divisao_modo: 'caracteres', divisao_tamanho: 50 });
    expect(partes.length).toBe(2);
    expect(partes.every(p => p.length <= 50)).toBe(true);
    expect(partes.join(' ')).toContain('dezesseis');
  });

  it('emoji e idioma viram regras de estilo no prompt', () => {
    const s = instrucoesComportamento({ emoji_politica: 'off', idioma_forcado: 'Português do Brasil' });
    expect(s).toContain('Não use emojis');
    expect(s).toContain('Português do Brasil');
  });

  it('assinatura no fim, ou nenhuma', () => {
    expect(formatarParte('oi', { assinatura_ativa: true, assinatura_texto: '— Stella, MentoArk' }, 'Stella')).toBe('oi\n\n— Stella, MentoArk');
    expect(formatarParte('oi', { assinatura_ativa: false }, 'Stella')).toBe('oi');
  });
});
