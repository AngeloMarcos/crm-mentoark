/**
 * Base de conhecimento que indexa sozinha (2026-10-30): trechos, texto indexado e RAG do agente.
 */
import { describe, it, expect } from 'vitest';
import { dividirEmChunks, textoDoConhecimento } from '../src/services/indexacao';
import { ragDoAgente } from '../src/services/agenteConversa';

describe('dividirEmChunks', () => {
  it('texto curto vira um trecho só; vazio vira nenhum', () => {
    expect(dividirEmChunks('Horário: 9h às 18h')).toEqual(['Horário: 9h às 18h']);
    expect(dividirEmChunks('   ')).toEqual([]);
  });

  it('texto longo respeita o tamanho e não perde conteúdo', () => {
    const paragrafo = 'Frase de exemplo com algumas palavras. '.repeat(30).trim();
    const texto = [paragrafo, paragrafo, paragrafo].join('\n\n');
    const chunks = dividirEmChunks(texto, 1500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.length <= 1500)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ').length).toBeGreaterThanOrEqual(texto.replace(/\s+/g, ' ').length - 10);
  });

  it('frase gigante sem pontuação é cortada à força', () => {
    const chunks = dividirEmChunks('x'.repeat(4000), 1500);
    expect(chunks.map(c => c.length)).toEqual([1500, 1500, 1000]);
  });
});

describe('textoDoConhecimento', () => {
  it('leva tipo, categoria e campo junto do conteúdo', () => {
    const t = textoDoConhecimento({ tipo: 'faq', categoria: 'Preço', campo: 'Tem fidelidade?', conteudo: 'Não, cancela quando quiser.' });
    expect(t).toBe('Pergunta frequente · Preço · Tem fidelidade?\nNão, cancela quando quiser.');
  });
});

describe('ragDoAgente', () => {
  it('padrões: ligado, 5 trechos, sem limiar', () => {
    expect(ragDoAgente({})).toEqual({ ativo: true, resultados: 5, limiar: 0 });
  });
  it('respeita o agente, com limites', () => {
    expect(ragDoAgente({ rag_ativo: false, rag_resultados: 50, rag_threshold: '0.70' })).toEqual({ ativo: false, resultados: 10, limiar: 0.7 });
  });
});
